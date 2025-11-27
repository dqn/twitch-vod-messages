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
 * Probe video length by sampling offsets
 * @param videoId - Twitch VOD ID
 * @param clientId - Twitch Client ID
 * @param probeInterval - Interval between probes in seconds
 * @returns Estimated video length in seconds
 * @throws {HttpError} When HTTP request fails
 * @throws {ResponseParseError} When response parsing fails
 */
async function probeVideoLength(
  videoId: string,
  clientId: string,
  probeInterval: number = 3600,
): Promise<number> {
  const probeOffsets = [0];
  // Probe every hour for the first 5 hours
  for (let i = 1; i <= 5; i++) {
    probeOffsets.push(i * probeInterval);
  }
  // Probe every 4 hours up to 48 hours
  for (let i = 8; i <= 48; i += 4) {
    probeOffsets.push(i * probeInterval);
  }

  const endpointUrl = "https://gql.twitch.tv/gql";
  const probeResults = await Promise.all(
    probeOffsets.map(async (offset) => {
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

      return {
        offset,
        hasNextPage: comments?.pageInfo?.hasNextPage ?? false,
        maxOffsetSeconds:
          comments?.edges?.at(-1)?.node?.contentOffsetSeconds ?? offset,
      };
    }),
  );

  // Find the first probe where hasNextPage is false
  const endProbe = probeResults.find((r) => !r.hasNextPage);
  if (endProbe) {
    return endProbe.maxOffsetSeconds;
  }

  // If all probes have hasNextPage = true, estimate as double the last offset
  const lastProbe = probeResults[probeResults.length - 1];
  if (lastProbe) {
    return lastProbe.maxOffsetSeconds * 2;
  }

  // Fallback to 0 if no results
  return 0;
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
   * @default 128
   */
  concurrency?: number;
  /**
   * Progress callback
   */
  onProgress?: (progress: FetchAllMessagesProgress) => void;
  /**
   * Video length in seconds (optional).
   * If provided, skips the probe phase for better performance.
   * If not provided, will be estimated automatically.
   */
  lengthSeconds?: number;
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
  const concurrency = options?.concurrency ?? 128;
  const onProgress = options?.onProgress;

  // 1. Retrieve Client ID
  const clientId = await retrieveClientId(videoId);

  // 2. Get or estimate video length
  const lengthSeconds =
    options?.lengthSeconds ?? (await probeVideoLength(videoId, clientId));

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

/**
 * Result type for fetchMessages
 */
export type FetchMessagesResult = {
  /**
   * Array of comment nodes
   */
  nodes: Node[];
};

/**
 * Options for fetchMessages
 */
export type FetchMessagesOptions = {
  /**
   * Content offset in seconds
   */
  contentOffsetSeconds?: number;
};

/**
 * Fetch messages from a video with content offset
 * @param videoId - Twitch VOD ID
 * @param options - Fetch options
 * @returns Result with nodes
 * @throws {HttpError} When HTTP request fails
 * @throws {ResponseParseError} When response parsing fails
 * @throws {ClientIdRetrievalError} When Client ID retrieval fails
 */
export async function fetchMessages(
  videoId: string,
  options?: FetchMessagesOptions,
): Promise<FetchMessagesResult> {
  const clientId = await retrieveClientId(videoId);
  const contentOffsetSeconds = options?.contentOffsetSeconds ?? 0;

  const endpointUrl = "https://gql.twitch.tv/gql";
  const res = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "client-id": clientId,
    },
    body: JSON.stringify(createPayload(videoId, contentOffsetSeconds)),
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
    return {
      nodes: [],
    };
  }

  const nodes = comments.edges.map((x) => x.node);

  return {
    nodes,
  };
}
