import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchMessages } from "../src/client";
import { HttpError, ResponseParseError } from "../src/errors";

// Mock globalThis.fetch
(globalThis as any).fetch = vi.fn();

describe("fetchMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Normal cases", () => {
    it("should fetch messages with default offset 0", async () => {
      // 1st call: HTML for retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // 2nd call: GraphQL response
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
                        cursor: "cursor1",
                        node: {
                          id: "comment1",
                          commenter: {
                            id: "user1",
                            login: "testuser1",
                            displayName: "Test User 1",
                          },
                          contentOffsetSeconds: 10,
                          createdAt: "2024-01-01T00:00:00Z",
                          message: {
                            fragments: [{ text: "Message 1", emote: null }],
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

      const result = await fetchMessages("12345");

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]?.contentOffsetSeconds).toBe(10);
    });

    it("should fetch messages with specified contentOffsetSeconds", async () => {
      // 1st call: HTML for retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // 2nd call: GraphQL response
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
                        cursor: "cursor2",
                        node: {
                          id: "comment2",
                          commenter: null,
                          contentOffsetSeconds: 60,
                          createdAt: "2024-01-01T00:00:00Z",
                          message: {
                            fragments: [{ text: "Message 2", emote: null }],
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

      const result = await fetchMessages("12345", { contentOffsetSeconds: 30 });

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]?.contentOffsetSeconds).toBe(60);
    });

    it("should return empty array when no comments found", async () => {
      // 1st call: HTML for retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // 2nd call: GraphQL response (null comments)
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

      const result = await fetchMessages("12345");

      expect(result.nodes).toHaveLength(0);
    });
  });

  describe("Error cases", () => {
    it("should throw HTTP error when fetch fails", async () => {
      // 1st call: HTML for retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // 2nd call: GraphQL response - HTTP error
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(fetchMessages("12345")).rejects.toThrow(HttpError);
    });

    it("should throw ResponseParseError on invalid GraphQL response", async () => {
      // 1st call: HTML for retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // 2nd call: GraphQL response - invalid JSON
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ invalid: "response" }),
      });

      await expect(fetchMessages("12345")).rejects.toThrow(ResponseParseError);
    });
  });
});
