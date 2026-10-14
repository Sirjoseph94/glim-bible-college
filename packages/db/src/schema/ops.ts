import { boolean, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { enumCheck, std, tstz } from "./columns";

/** Owner: ops (TRD §15.3). The latest result of each integration's status check, for the ops page. */
export const integrationChecks = pgTable("integration_checks", {
  provider: text().primaryKey(),
  checkedAt: tstz("checked_at").notNull(),
  ok: boolean().notNull(),
  result: jsonb().$type<Record<string, unknown>>().notNull(),
});

/**
 * Owner: ops (TRD §6.2). Each integration's settings and health. Secrets stay in env vars, except
 * the YouTube channel's OAuth refresh token, which only a consent screen can produce: it is kept
 * in `secret_ciphertext`, AES-256-GCM under `TOKEN_ENCRYPTION_KEY`, and never returned or logged.
 */
export const integrationConfigs = pgTable(
  "integration_configs",
  {
    ...std(),
    provider: text().notNull().unique(),
    status: text().notNull().default("UNVERIFIED"),
    config: jsonb().$type<Record<string, unknown>>().notNull(),
    secretCiphertext: text("secret_ciphertext"),
    verifiedAt: tstz("verified_at"),
    lastError: text("last_error"),
  },
  (t) => [
    enumCheck("integration_configs.provider", t.provider),
    enumCheck("integration_configs.status", t.status),
  ],
);
