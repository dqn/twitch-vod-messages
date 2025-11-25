import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTwitchClient } from "../src/client";
import {
  ClientIdRetrievalError,
  HttpError,
  ResponseParseError,
} from "../src/errors";

// Mock globalThis.fetch
(globalThis as any).fetch = vi.fn();

describe("createTwitchClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Normal cases", () => {
    it("Can retrieve Client ID from HTML and parse GraphQL response correctly", async () => {
      // 1st call: HTML for retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // 2nd call: GraphQL response for fetchNext
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
                            login: "testuser",
                            displayName: "Test User",
                          },
                          contentOffsetSeconds: 10,
                          createdAt: "2024-01-01T00:00:00Z",
                          message: {
                            fragments: [{ text: "Hello World", emote: null }],
                            userBadges: [],
                            userColor: "#FF0000",
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

      const client = await createTwitchClient("12345");
      const result = await client.fetchNext();

      expect(result.nodes).toHaveLength(1);
      expect(result.hasNextPage).toBe(true);
      expect(result.nodes[0]?.id).toBe("comment1");
      expect(result.nodes[0]?.message.fragments[0]?.text).toBe("Hello World");
    });

    it("Can fetch comments from multiple pages", async () => {
      // retrieveClientId
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      // Page 1
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
                          commenter: null,
                          contentOffsetSeconds: 5,
                          createdAt: "2024-01-01T00:00:00Z",
                          message: {
                            fragments: [{ text: "First", emote: null }],
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

      // Page 2
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
                          contentOffsetSeconds: 10,
                          createdAt: "2024-01-01T00:00:05Z",
                          message: {
                            fragments: [{ text: "Second", emote: null }],
                            userBadges: [],
                            userColor: null,
                          },
                        },
                      },
                    ],
                    pageInfo: {
                      hasNextPage: false,
                      hasPreviousPage: true,
                    },
                  },
                },
              },
            },
          ]),
      });

      const client = await createTwitchClient("12345");

      const page1 = await client.fetchNext();
      expect(page1.nodes).toHaveLength(1);
      expect(page1.hasNextPage).toBe(true);
      expect(page1.nodes[0]?.message.fragments[0]?.text).toBe("First");

      const page2 = await client.fetchNext();
      expect(page2.nodes).toHaveLength(1);
      expect(page2.hasNextPage).toBe(false);
      expect(page2.nodes[0]?.message.fragments[0]?.text).toBe("Second");
    });

    it("Returns empty result when comments is null", async () => {
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

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

      const client = await createTwitchClient("12345");
      const result = await client.fetchNext();

      expect(result.nodes).toHaveLength(0);
      expect(result.hasNextPage).toBe(false);
    });

    it("Filters duplicate comments", async () => {
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      const duplicateNode = {
        cursor: "cursor1",
        node: {
          id: "comment1",
          commenter: null,
          contentOffsetSeconds: 5,
          createdAt: "2024-01-01T00:00:00Z",
          message: {
            fragments: [{ text: "Duplicate", emote: null }],
            userBadges: [],
            userColor: null,
          },
        },
      };

      // Return response with the same comment twice
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
                      hasNextPage: true,
                      hasPreviousPage: false,
                    },
                  },
                },
              },
            },
          ]),
      });

      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              data: {
                video: {
                  comments: {
                    edges: [duplicateNode], // Same comment
                    pageInfo: {
                      hasNextPage: false,
                      hasPreviousPage: true,
                    },
                  },
                },
              },
            },
          ]),
      });

      const client = await createTwitchClient("12345");

      const page1 = await client.fetchNext();
      expect(page1.nodes).toHaveLength(1);

      const page2 = await client.fetchNext();
      expect(page2.nodes).toHaveLength(0); // Duplicates are removed
    });
  });

  describe("Error cases", () => {
    it("Throws HttpError on HTTP error during Client ID retrieval", async () => {
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(createTwitchClient("invalid")).rejects.toThrow(HttpError);
    });

    it("Throws ClientIdRetrievalError when Client ID is not found in HTML", async () => {
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("<html>No client ID here</html>"),
      });

      await expect(createTwitchClient("12345")).rejects.toThrow(
        ClientIdRetrievalError,
      );
    });

    it("Throws HttpError on GraphQL API HTTP error", async () => {
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const client = await createTwitchClient("12345");
      await expect(client.fetchNext()).rejects.toThrow(HttpError);
    });

    it("Throws ResponseParseError on GraphQL response parse error", async () => {
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ invalid: "response" }),
      });

      const client = await createTwitchClient("12345");
      await expect(client.fetchNext()).rejects.toThrow(ResponseParseError);
    });

    it("Throws ResponseParseError when GraphQL response is empty array", async () => {
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const client = await createTwitchClient("12345");
      await expect(client.fetchNext()).rejects.toThrow(ResponseParseError);
    });

    it("Returns empty result when hasNextPage is false", async () => {
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>clientId="test-client-id"</html>'),
      });

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
                          commenter: null,
                          contentOffsetSeconds: 5,
                          createdAt: "2024-01-01T00:00:00Z",
                          message: {
                            fragments: [{ text: "Last", emote: null }],
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

      const client = await createTwitchClient("12345");
      const page1 = await client.fetchNext();
      expect(page1.hasNextPage).toBe(false);

      // 2nd call returns empty
      const page2 = await client.fetchNext();
      expect(page2.nodes).toHaveLength(0);
      expect(page2.hasNextPage).toBe(false);
    });
  });
});
