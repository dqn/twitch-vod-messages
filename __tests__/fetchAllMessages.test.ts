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
    it("should probe video length and fetch comments in parallel", async () => {
      // 1st call: HTML for retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // 2nd-7th calls: Probe requests (6 offsets: 0, 3600, 7200, 10800, 14400, 18000)
      // Probe 0: hasNextPage = true
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
                        cursor: "probe0",
                        node: {
                          id: "probe0",
                          commenter: null,
                          contentOffsetSeconds: 100,
                          createdAt: "2024-01-01T00:00:00Z",
                          message: {
                            fragments: [{ text: "Probe", emote: null }],
                            userBadges: [],
                            userColor: null,
                          },
                        },
                      },
                    ],
                    pageInfo: {
                      hasNextPage: true,
                      hasPreviousPage: false,
                    },
                  },
                },
              },
            },
          ]),
      });

      // Probe 3600: hasNextPage = false (end found)
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
                        cursor: "probe3600",
                        node: {
                          id: "probe3600",
                          commenter: null,
                          contentOffsetSeconds: 3650,
                          createdAt: "2024-01-01T01:00:00Z",
                          message: {
                            fragments: [{ text: "Probe", emote: null }],
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

      // Remaining probes (7200, 10800, 14400, 18000, ...)
      for (let i = 0; i < 15; i++) {
        ((globalThis as any).fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                data: {
                  video: {
                    comments: {
                      edges: [],
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

      // 8th-12th calls: Chunk fetches (concurrency=5, estimated length=3650)
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
                            contentOffsetSeconds: i * 730 + 10,
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

    it("should skip probe when lengthSeconds is provided", async () => {
      // 1st call: HTML for retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // No probe calls - directly to chunk fetches
      // 2nd-3rd calls: Chunk fetches (concurrency=2, lengthSeconds=100)
      for (let i = 0; i < 2; i++) {
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
                            contentOffsetSeconds: i * 50 + 10,
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

      const messages = await fetchAllMessages("12345", {
        concurrency: 2,
        lengthSeconds: 100,
      });

      expect(messages).toHaveLength(2);
    });

    it("should fallback to single fetch when estimatedlength is 0", async () => {
      // retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // All 17 probes return no comments
      for (let i = 0; i < 17; i++) {
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
      }

      // Single fetch at offset 0
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
  });

  describe("Error cases", () => {
    it("should throw HTTP error when probe request fails", async () => {
      // retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // First probe request fails
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(fetchAllMessages("12345")).rejects.toThrow(HttpError);
    });

    it("should throw error on invalid probe response", async () => {
      // retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // All 17 probe requests return invalid response (Promise.all runs all 17)
      for (let i = 0; i < 17; i++) {
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
