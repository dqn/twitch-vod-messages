import type { z } from "zod";
import { schema } from "./schema";

async function retrieveClientId(videoId: string) {
  const res = await fetch(`https://www.twitch.tv/videos/${videoId}`);
  const html = await res.text();

  const search = 'clientId="';
  const searchIndex = html.indexOf(search);

  if (searchIndex === -1) {
    throw new Error("failed to find client id");
  }

  const startIndex = searchIndex + search.length;
  const endIndex = html.indexOf('"', startIndex);
  const clientId = html.slice(startIndex, endIndex);

  return clientId;
}

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

export type Node = NonNullable<
  z.infer<typeof schema>["0"]["data"]["video"]["comments"]
>["edges"][number]["node"];

export type FetchResult = {
  nodes: Node[];
  hasNextPage: boolean;
};

export type TwitchClient = {
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

      const res = await fetch("https://gql.twitch.tv/gql", {
        method: "POST",
        headers: {
          "client-id": clientId,
        },
        body: JSON.stringify(createPayload(videoId, offset)),
      });

      const json = await res.json();
      const result = schema.safeParse(json);

      if (!result.success) {
        // console.error(result.error.errors);
        // console.log(JSON.stringify(json));
        throw new Error("failed to parse response");
      }

      const comments = result.data[0]?.data.video.comments;

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
