import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAllMessages } from "../src/client";
import { HttpError, ResponseParseError } from "../src/errors";

// Mock globalThis.fetch
(globalThis as any).fetch = vi.fn();

describe("fetchAllMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Normal cases", () => {
    it("should retrieve video length and fetch comments in parallel", async () => {
      // 1st call: HTML for retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // 2nd call: HTML for retrieveVideoLength (duration: PT1M40S = 100 seconds)
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>"duration":"PT1M40S"</html>'),
      });

      // 3rd-7th calls: Comments from different offsets
      // If concurrency=5, 5 parallel requests occur
      for (let i = 0; i < 5; i++) {
        ((globalThis as any).fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                data: {
                  video: {
                    comments: {
                      edges: [
                        {
                          cursor: `cursor${i}`,
                          node: {
                            id: `comment${i}`,
                            commenter: {
                              id: `user${i}`,
                              login: `testuser${i}`,
                              displayName: `Test User ${i}`,
                            },
                            contentOffsetSeconds: i * 20 + 10,
                            createdAt: "2024-01-01T00:00:00Z",
                            message: {
                              fragments: [
                                { text: `Message ${i}`, emote: null },
                              ],
                              userBadges: [],
                              userColor: "#FF0000",
                            },
                          },
                        },
                      ],
                      pageInfo: {
                        hasNextPage: false,
                        hasPreviousPage: false,
                      },
                    },
                  },
                },
              },
            ]),
        });
      }

      const messages = await fetchAllMessages("12345", { concurrency: 5 });

      expect(messages).toHaveLength(5);
      // Verify sorted
      for (let i = 0; i < messages.length - 1; i++) {
        expect(messages[i]!.contentOffsetSeconds).toBeLessThanOrEqual(
          messages[i + 1]!.contentOffsetSeconds,
        );
      }
    });

    it("should exclude duplicate comments", async () => {
      // retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // 2nd call: HTML for retrieveVideoLength (duration: PT40S = 40 seconds)
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>"duration":"PT40S"</html>'),
      });

      const duplicateNode = {
        cursor: "cursor1",
        node: {
          id: "comment1",
          commenter: null,
          contentOffsetSeconds: 15,
          createdAt: "2024-01-01T00:00:00Z",
          message: {
            fragments: [{ text: "Duplicate", emote: null }],
            userBadges: [],
            userColor: null,
          },
        },
      };

      // Two chunks return the same comment
      for (let i = 0; i < 2; i++) {
        ((globalThis as any).fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                data: {
                  video: {
                    comments: {
                      edges: [duplicateNode],
                      pageInfo: {
                        hasNextPage: false,
                        hasPreviousPage: false,
                      },
                    },
                  },
                },
              },
            ]),
        });
      }

      const messages = await fetchAllMessages("12345", { concurrency: 2 });

      // Verify duplicates are removed and only 1 remains
      expect(messages).toHaveLength(1);
      expect(messages[0]?.id).toBe("comment1");
    });

    it("should call progress callback", async () => {
      // retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // 2nd call: HTML for retrieveVideoLength (duration: PT1M = 60 seconds)
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>"duration":"PT1M"</html>'),
      });

      // Comments for 3 chunks
      for (let i = 0; i < 3; i++) {
        ((globalThis as any).fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                data: {
                  video: {
                    comments: {
                      edges: [
                        {
                          cursor: `cursor${i}`,
                          node: {
                            id: `comment${i}`,
                            commenter: null,
                            contentOffsetSeconds: i * 20,
                            createdAt: "2024-01-01T00:00:00Z",
                            message: {
                              fragments: [
                                { text: `Message ${i}`, emote: null },
                              ],
                              userBadges: [],
                              userColor: null,
                            },
                          },
                        },
                      ],
                      pageInfo: {
                        hasNextPage: false,
                        hasPreviousPage: false,
                      },
                    },
                  },
                },
              },
            ]),
        });
      }

      const progressUpdates: number[] = [];
      await fetchAllMessages("12345", {
        concurrency: 3,
        onProgress: (progress) => {
          progressUpdates.push(progress.percentage);
        },
      });

      // Verify progress is between 0 and 100
      expect(progressUpdates.length).toBeGreaterThan(0);
      for (const percentage of progressUpdates) {
        expect(percentage).toBeGreaterThan(0);
        expect(percentage).toBeLessThanOrEqual(100);
      }
      // Verify last progress is 100%
      expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
    });
  });

  describe("Error cases", () => {
    it("should throw HTTP error when fetching video metadata fails", async () => {
      // retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // 2nd call: HTML for retrieveVideoLength - HTTP error
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(fetchAllMessages("12345")).rejects.toThrow(HttpError);
    });

    it("should fallback to single chunk fetch when video length is not found", async () => {
      // retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // 2nd call: HTML for retrieveVideoLength - no duration found (returns 0)
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("<html>No duration here</html>"),
      });

      // 3rd call: Comments for fallback to single chunk fetch
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              data: {
                video: {
                  comments: null,
                },
              },
            },
          ]),
      });

      const messages = await fetchAllMessages("12345");
      // Should return empty array when no comments
      expect(messages).toHaveLength(0);
    });

    it("should throw error on invalid video metadata response", async () => {
      // retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // 2nd call: HTML for retrieveVideoLength (duration: PT1M = 60 seconds)
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>"duration":"PT1M"</html>'),
      });

      // 3rd-7th calls: Comments - invalid response (5 parallel chunks)
      for (let i = 0; i < 5; i++) {
        ((globalThis as any).fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ invalid: "response" }),
        });
      }

      await expect(fetchAllMessages("12345")).rejects.toThrow(
        ResponseParseError,
      );
    });
  });
});
