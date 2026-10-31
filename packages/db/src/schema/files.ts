import { bigint, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { enumCheck, std } from "./columns";
import { users } from "./identity";

/**
 * Owner: content. Every uploaded file (TRD §6.6, §14.1). The bytes live in the private bucket
 * under `storage_key`; the browser uploads and downloads them through presigned URLs.
 */
export const files = pgTable(
  "files",
  {
    ...std(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    purpose: text().notNull(),
    storageKey: text("storage_key").notNull().unique(),
    originalName: text("original_name").notNull(),
    /** Lower-case MIME type, from the per-purpose allow-list. */
    mime: text().notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text(),
    status: text().notNull().default("PENDING_UPLOAD"),
    /** The bucket's multipart upload, for files above 8 MB until they're complete (§14.1). */
    uploadId: text("upload_id"),
  },
  (t) => [enumCheck("files.purpose", t.purpose), enumCheck("files.status", t.status)],
);
