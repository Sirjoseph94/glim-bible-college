import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { enumCheck, stdRo, tstz } from "./columns";
import { users } from "./identity";

/**
 * Owner: notifications. In-app notifications, and the email for each where one is due (TRD §15.1).
 * `data` holds what the kind's template needs; never sensitive applicant answers (INV-15).
 */
export const notifications = pgTable(
  "notifications",
  {
    ...stdRo(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    title: text().notNull(),
    body: text(),
    data: jsonb()
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    readAt: tstz("read_at"),
    emailStatus: text("email_status").notNull().default("NOT_REQUESTED"),
    dedupeKey: text("dedupe_key"),
  },
  (t) => [
    enumCheck("notifications.email_status", t.emailStatus),
    unique("notifications_user_dedupe").on(t.userId, t.dedupeKey),
    index("notifications_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);
