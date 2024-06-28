import { z } from "zod";

export const schema = z.array(
  z.object({
    data: z.object({
      video: z.object({
        comments: z.union([
          z.null(),
          z.object({
            edges: z.array(
              z.object({
                cursor: z.string(),
                node: z.object({
                  id: z.string(),
                  commenter: z.union([
                    z.null(),
                    z.object({
                      id: z.string(),
                      login: z.string(),
                      displayName: z.string(),
                    }),
                  ]),
                  contentOffsetSeconds: z.number(),
                  createdAt: z.string(),
                  message: z.object({
                    fragments: z.array(
                      z.object({
                        emote: z.union([
                          z.null(),
                          z.object({
                            id: z.string(),
                            emoteID: z.string(),
                            from: z.number(),
                          }),
                        ]),
                        text: z.string(),
                      }),
                    ),
                    userBadges: z.array(
                      z.object({
                        id: z.string(),
                        setID: z.string(),
                        version: z.string(),
                      }),
                    ),
                    userColor: z.union([z.null(), z.string()]),
                  }),
                }),
              }),
            ),
            pageInfo: z.object({
              hasNextPage: z.boolean(),
              hasPreviousPage: z.boolean(),
            }),
          }),
        ]),
      }),
    }),
  }),
);
