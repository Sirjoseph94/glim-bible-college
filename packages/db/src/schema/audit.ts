import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { enumCheck, inet, stdRo } from "./columns";

/**
 * Owner: audit. APPEND-ONLY (§6.7): glim_app has no UPDATE/DELETE, and a trigger rejects them
 * for everyone. `metadata` never contains sensitive applicant answers (INV-15).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    ...stdRo(),
    actorUserId: uuid("actor_user_id"),
    actorType: text("actor_type").notNull(),
    action: text().notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    outcome: text().notNull(),
    metadata: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    requestId: text("request_id"),
    ip: inet(),
    userAgent: text("user_agent"),
  },
  (t) => [
    enumCheck("audit_logs.actor_type", t.actorType),
    enumCheck("audit_logs.outcome", t.outcome),
    index("audit_logs_created_at").on(t.createdAt.desc()),
    index("audit_logs_resource").on(t.resourceType, t.resourceId),
  ],
);
