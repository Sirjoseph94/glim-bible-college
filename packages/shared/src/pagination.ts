import { z } from "zod";
import { AppError } from "./result";

/** Cursor pagination query (§5.4): `?limit` (default 25, max 100) and `?cursor`. */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CursorPosition {
  sortKey: string;
  id: string;
}

const cursorSchema = z
  .tuple([z.string(), z.string()])
  .transform(([sortKey, id]): CursorPosition => ({ sortKey, id }));

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify([position.sortKey, position.id])).toString("base64url");
}

export function decodeCursor(cursor: string): CursorPosition {
  try {
    const raw: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const parsed = cursorSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to the validation error below
  }
  throw new AppError("VALIDATION_FAILED", "The cursor is invalid.", {
    fieldErrors: [{ path: "cursor", code: "invalid_cursor", message: "The cursor is invalid." }],
  });
}

/**
 * Builds a page from rows fetched with `limit + 1`: the extra row, if present, only signals that
 * another page exists.
 */
export function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  sortKeyOf: (row: T) => string,
): Page<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  if (last === undefined) return { items, nextCursor: null };
  return { items, nextCursor: encodeCursor({ sortKey: sortKeyOf(last), id: last.id }) };
}
