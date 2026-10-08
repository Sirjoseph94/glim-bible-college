import { integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { enumCheck, stdRo, tstz } from "./columns";

/**
 * Owner: shared platform. One row per (user, operation, Idempotency-Key) (TRD §5.4): a repeated
 * request replays the stored response instead of acting twice. Keys expire after 48 h.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    ...stdRo(),
    userId: uuid("user_id").notNull(),
    operation: text().notNull(),
    key: text().notNull(),
    requestHash: text("request_hash").notNull(),
    status: text().notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    expiresAt: tstz("expires_at").notNull(),
  },
  (t) => [
    unique("idempotency_keys_user_operation_key").on(t.userId, t.operation, t.key),
    enumCheck("idempotency_keys.status", t.status),
  ],
);
