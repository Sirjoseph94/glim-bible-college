import { z } from "zod";

/** Cursor pagination query (§5.4): `?limit` (default 25, max 100) and `?cursor`. */
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
});

export type PageQuery = z.infer<typeof pageQuery>;

/** A page of results: `{ items, nextCursor }` (§5.4). */
export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
