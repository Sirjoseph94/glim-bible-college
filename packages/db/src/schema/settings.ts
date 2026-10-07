import { sql } from "drizzle-orm";
import { check, integer, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

/** Owner: identity. Exactly one row (ADR-0001, TRD §6.2). */
export const settings = pgTable(
  "settings",
  {
    id: smallint().primaryKey().default(1),
    name: text().notNull().default("GLIM Online Bible College"),
    timezone: text().notNull().default("Africa/Lagos"),
    staffEmailDomains: text("staff_email_domains")
      .array()
      .notNull()
      .default(sql`'{}'`),
    youtubeChannelUrls: text("youtube_channel_urls")
      .array()
      .notNull()
      .default(sql`'{}'`),
    statementOfFaithUrl: text("statement_of_faith_url"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    version: integer().notNull().default(1),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`)],
);
