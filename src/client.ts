import type { z } from "zod";
import { schema } from "./schema";
import {
  ClientIdRetrievalError,
  HttpError,
  ResponseParseError,
} from "./errors";

/**
 * Retrieve Client ID from Twitch VOD page HTML
 * @param videoId - Twitch VOD ID
 * @returns Client ID string
 * @throws {HttpError} When HTTP request fails
 * @throws {ClientIdRetrievalError} When Client ID retrieval fails
 */
async function retrieveClientId(videoId: string): Promise<string> {
  const url = `https://www.twitch.tv/videos/${videoId}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new HttpError(res.status, url);
  }

  const html = await res.text();

  const search = 'clientId="';
  const searchIndex = html.indexOf(search);

  if (searchIndex === -1) {
    throw new ClientIdRetrievalError(
      `Failed to find client ID in HTML for video ${videoId}`,
    );
  }

  const startIndex = searchIndex + search.length;
  const endIndex = html.indexOf('"', startIndex);
  const clientId = html.slice(startIndex, endIndex);

  return clientId;
}

/**
 * Create request payload for Twitch GraphQL API
 * @param videoId - Twitch VOD ID
 * @param contentOffsetSeconds - Content offset in seconds
 * @returns GraphQL request payload
 */
function createPayload(videoId: string, contentOffsetSeconds: number) {
  return [
    {
      operationName: "VideoCommentsByOffsetOrCursor",
      variables: {
        videoID: videoId,
        contentOffsetSeconds,
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash:
            "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a",
        },
      },
    },
  ];
}

/**
 * VOD comment node type
 */
export type Node = NonNullable<
  z.infer<typeof schema>["0"]["data"]["video"]["comments"]
>["edges"][number]["node"];

/**
 * Return type of fetchNext
 */
export type FetchResult = {
  nodes: Node[];
  hasNextPage: boolean;
};

/**
 * Twitch VOD comment fetching client
 */
export type TwitchClient = {
  /**
   * Fetch the next page of comments
   * @returns Array of comment nodes and pagination info
   * @throws {HttpError} When GraphQL API request fails
   * @throws {ResponseParseError} When response parsing fails
   */
  fetchNext: () => Promise<FetchResult>;
};

export async function createTwitchClient(
  videoId: string,
  offsetSeconds = 0,
): Promise<TwitchClient> {
  const clientId = await retrieveClientId(videoId);

  let offset = offsetSeconds;
  let hasNextPage = true;
  const set = new Set<string>();

  return {
    fetchNext: async () => {
      if (!hasNextPage) {
        return {
          nodes: [],
          hasNextPage,
        };
      }

      const endpointUrl = "https://gql.twitch.tv/gql";
      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "client-id": clientId,
        },
        body: JSON.stringify(createPayload(videoId, offset)),
      });

      if (!res.ok) {
        throw new HttpError(res.status, endpointUrl);
      }

      const json = await res.json();
      const result = schema.safeParse(json);

      if (!result.success) {
        throw new ResponseParseError(
          "Failed to parse GraphQL response",
          result.error.errors,
        );
      }

      const firstResult = result.data[0];
      if (firstResult === undefined) {
        throw new ResponseParseError("GraphQL response array is empty");
      }

      const comments = firstResult.data.video.comments;

      if (comments == null) {
        hasNextPage = false;

        return {
          nodes: [],
          hasNextPage,
        };
      }

      const nodes = comments.edges
        .map((x) => x.node)
        .filter((x) => !set.has(x.id));

      for (const node of nodes) {
        set.add(node.id);
      }

      offset = nodes.at(-1)?.contentOffsetSeconds ?? offset + 1;
      hasNextPage = comments.pageInfo.hasNextPage;

      return {
        nodes,
        hasNextPage,
      };
    },
  };
}
