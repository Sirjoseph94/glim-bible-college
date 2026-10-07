import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";
import { page, pageQuery } from "../pagination";

export const auditLogItemSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  actorUserId: z.uuid().nullable(),
  actorType: z.enum(ENUMS["audit_logs.actor_type"]),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  outcome: z.enum(ENUMS["audit_logs.outcome"]),
  metadata: z.record(z.string(), z.unknown()),
  requestId: z.string().nullable(),
});

export type AuditLogItem = z.infer<typeof auditLogItemSchema>;

export const listAuditLogs = endpoint({
  method: "GET",
  path: "/audit-logs",
  summary: "The audit trail, newest first",
  tag: "Audit",
  auth: "session",
  permission: "audit:log:read",
  query: pageQuery.extend({
    resourceType: z.string().max(64).optional(),
    resourceId: z.string().max(128).optional(),
    actorUserId: z.uuid().optional(),
  }),
  response: page(auditLogItemSchema),
});
