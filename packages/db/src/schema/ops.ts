import { boolean, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { tstz } from "./columns";

/** Owner: ops (TRD §15.3). The latest result of each integration's status check, for the ops page. */
export const integrationChecks = pgTable("integration_checks", {
  provider: text().primaryKey(),
  checkedAt: tstz("checked_at").notNull(),
  ok: boolean().notNull(),
  result: jsonb().$type<Record<string, unknown>>().notNull(),
});
