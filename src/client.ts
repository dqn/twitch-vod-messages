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
 * Parse ISO 8601 duration string (e.g. PT1H2M3S)
 * @param duration - Duration string
 * @returns Duration in seconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Retrieve video length in seconds
 * @param videoId - Twitch VOD ID
 * @returns Video length in seconds
 * @throws {HttpError} When HTTP request fails
 */
async function retrieveVideoLength(videoId: string): Promise<number> {
  const url = `https://www.twitch.tv/videos/${videoId}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new HttpError(res.status, url);
  }

  const html = await res.text();
  const match = html.match(/"duration":"(PT.*?)"/);

  if (!match || !match[1]) {
    return 0;
  }

  return parseDuration(match[1]);
}

/**
 * Fetch messages from a specific offset until the end or next chunk
 * @param videoId - Twitch VOD ID
 * @param clientId - Twitch Client ID
 * @param startOffset - Starting offset in seconds
 * @param endOffset - Optional ending offset in seconds
 * @returns Array of comment nodes
 */
async function fetchMessagesFromOffset(
  videoId: string,
  clientId: string,
  startOffset: number,
  endOffset?: number,
): Promise<Node[]> {
  const nodes: Node[] = [];
  const set = new Set<string>();
  let offset = startOffset;
  let hasNextPage = true;

  while (hasNextPage) {
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
      break;
    }

    const newNodes = comments.edges
      .map((x) => x.node)
      .filter((x) => !set.has(x.id));

    for (const node of newNodes) {
      // If endOffset is specified, do not include comments beyond it
      if (endOffset !== undefined && node.contentOffsetSeconds >= endOffset) {
        hasNextPage = false;
        break;
      }
      set.add(node.id);
      nodes.push(node);
    }

    if (!comments.pageInfo.hasNextPage) {
      break;
    }

    offset = newNodes.at(-1)?.contentOffsetSeconds ?? offset + 1;
  }

  return nodes;
}

/**
 * Progress information for fetchAllMessages
 */
export type FetchAllMessagesProgress = {
  /**
   * Total number of chunks
   */
  totalChunks: number;
  /**
   * Number of completed chunks
   */
  completedChunks: number;
  /**
   * Current progress percentage (0-100)
   */
  percentage: number;
};

/**
 * Options for fetchAllMessages
 */
export type FetchAllMessagesOptions = {
  /**
   * Number of parallel requests
   * @default 5
   */
  concurrency?: number;
  /**
   * Progress callback
   */
  onProgress?: (progress: FetchAllMessagesProgress) => void;
};

/**
 * Fetch all messages from a video in parallel
 * @param videoId - Twitch VOD ID
 * @param options - Fetch options
 * @returns Array of all comment nodes, sorted by contentOffsetSeconds
 * @throws {HttpError} When HTTP request fails
 * @throws {ResponseParseError} When response parsing fails
 * @throws {ClientIdRetrievalError} When Client ID retrieval fails
 */
export async function fetchAllMessages(
  videoId: string,
  options?: FetchAllMessagesOptions,
): Promise<Node[]> {
  const concurrency = options?.concurrency ?? 5;
  const onProgress = options?.onProgress;

  // 1. Retrieve Client ID and video length
  const clientId = await retrieveClientId(videoId);
  const lengthSeconds = await retrieveVideoLength(videoId);

  if (lengthSeconds === 0) {
    return fetchMessagesFromOffset(videoId, clientId, 0);
  }

  // 2. Calculate start positions based on concurrency
  const chunkSize = Math.ceil(lengthSeconds / concurrency);
  const chunks: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < concurrency; i++) {
    const start = i * chunkSize;
    const end = Math.min((i + 1) * chunkSize, lengthSeconds);
    if (start < lengthSeconds) {
      chunks.push({ start, end });
    }
  }

  // 3. Fetch comments from each chunk in parallel
  let completedChunks = 0;
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const nodes = await fetchMessagesFromOffset(
        videoId,
        clientId,
        chunk.start,
        chunk.end,
      );
      completedChunks++;

      if (onProgress) {
        onProgress({
          totalChunks: chunks.length,
          completedChunks,
          percentage: Math.round((completedChunks / chunks.length) * 100),
        });
      }

      return nodes;
    }),
  );

  // 4. Merge results, deduplicate, and sort
  const allNodes = results.flat();
  const uniqueNodes = Array.from(
    new Map(allNodes.map((node) => [node.id, node])).values(),
  );

  return uniqueNodes.sort(
    (a, b) => a.contentOffsetSeconds - b.contentOffsetSeconds,
  );
}
