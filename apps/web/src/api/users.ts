import type { audit, users } from "@glim/contracts";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";

export const STAFF_ROLE_LABELS = {
  SYSTEM_ADMIN: "System Admin",
  ADMISSIONS_OFFICER: "Admissions Officer",
  REGISTRAR: "Registrar",
  ACADEMIC_ADMIN: "Academic Admin",
} as const;

export type StaffRole = keyof typeof STAFF_ROLE_LABELS;

export const usersQuery = (filter: { q?: string; status?: string; cursor?: string }) =>
  queryOptions({
    queryKey: ["users", filter],
    queryFn: ({ signal }) =>
      api<typeof users.listUsers>("GET", "/users", { signal, query: filter }),
  });

export const userQuery = (id: string) =>
  queryOptions({
    queryKey: ["user", id],
    queryFn: ({ signal }) =>
      api<typeof users.getUser>("GET", "/users/:id", { signal, params: { id } }),
  });

export const auditQuery = (filter: {
  resourceId?: string;
  actorUserId?: string;
  cursor?: string;
}) =>
  queryOptions({
    queryKey: ["audit", filter],
    queryFn: ({ signal }) =>
      api<typeof audit.listAuditLogs>("GET", "/audit-logs", { signal, query: filter }),
  });
