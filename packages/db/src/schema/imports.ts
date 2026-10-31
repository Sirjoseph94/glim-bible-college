import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { enumCheck, std } from "./columns";
import { files } from "./files";
import { users } from "./identity";

export interface ImportStats {
  total: number;
  valid: number;
  invalid: number;
  created: number;
  updated: number;
  unchanged: number;
  failure: string | null;
}

/**
 * Owner: imports. One run of a CSV import (TRD §6.8, §15.2): a dry run or a commit of a file whose
 * hash must not change in between. `rows_done` makes a commit resumable by row offset.
 */
export const importJobs = pgTable(
  "import_jobs",
  {
    ...std(),
    kind: text().notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "restrict" }),
    fileSha256: text("file_sha256").notNull(),
    dryRun: boolean("dry_run").notNull().default(true),
    status: text().notNull().default("QUEUED"),
    stats: jsonb()
      .$type<ImportStats>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    errorFileId: uuid("error_file_id").references(() => files.id, { onDelete: "set null" }),
    rowsDone: integer("rows_done").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => [enumCheck("import_jobs.kind", t.kind), enumCheck("import_jobs.status", t.status)],
);
