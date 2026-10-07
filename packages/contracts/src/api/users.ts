import { z } from "zod";
import { ENUMS, STAFF_ROLES } from "../enums";
import { endpoint } from "../http";
import { page, pageQuery } from "../pagination";

const userStatus = z.enum(ENUMS["users.status"]);
const staffRole = z.enum(STAFF_ROLES);
const reason = z.string().trim().min(3).max(500);
const idParams = z.object({ id: z.uuid() });

export const roleAssignmentSchema = z.object({
  id: z.uuid(),
  role: staffRole,
  grantedAt: z.iso.datetime(),
  reason: z.string().nullable(),
});

export const userListItemSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  status: userStatus,
  roles: z.array(staffRole),
  lastLoginAt: z.iso.datetime().nullable(),
});

export const userDetailSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  status: userStatus,
  timezone: z.string().nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  version: z.number().int(),
  roles: z.array(roleAssignmentSchema),
});

export type UserListItem = z.infer<typeof userListItemSchema>;
export type UserDetail = z.infer<typeof userDetailSchema>;

export const listUsers = endpoint({
  method: "GET",
  path: "/users",
  summary: "List users, filtered by status or a name/email search",
  tag: "Users",
  auth: "session",
  permission: "identity:user:read",
  query: pageQuery.extend({
    status: userStatus.optional(),
    q: z.string().trim().min(1).max(100).optional(),
  }),
  response: page(userListItemSchema),
});

export const inviteUser = endpoint({
  method: "POST",
  path: "/users",
  summary: "Create a staff account with roles and email an invite",
  tag: "Users",
  auth: "session",
  permission: "identity:user:manage",
  body: z.object({
    email: z.email().max(254),
    displayName: z.string().trim().min(1).max(120),
    roles: z.array(staffRole).max(STAFF_ROLES.length).default([]),
  }),
  response: z.object({ user: userDetailSchema, emailSent: z.boolean() }),
});

export const getUser = endpoint({
  method: "GET",
  path: "/users/:id",
  summary: "A user with their active roles",
  tag: "Users",
  auth: "session",
  permission: "identity:user:read",
  resource: { type: "user", param: "id" },
  params: idParams,
  response: userDetailSchema,
});

export const updateUser = endpoint({
  method: "PATCH",
  path: "/users/:id",
  summary: "Rename, suspend or reactivate a user",
  tag: "Users",
  auth: "session",
  permission: "identity:user:manage",
  resource: { type: "user", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      displayName: z.string().trim().min(1).max(120).optional(),
      status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
      reason: reason.optional(),
    })
    .refine((b) => b.displayName !== undefined || b.status !== undefined, "Nothing to change"),
  response: userDetailSchema,
});

export const deactivateUser = endpoint({
  method: "POST",
  path: "/users/:id/deactivate",
  summary: "Deactivate a user: they can no longer sign in, and their sessions end",
  tag: "Users",
  auth: "session",
  permission: "identity:user:manage",
  resource: { type: "user", param: "id" },
  params: idParams,
  body: z.object({ reason }),
  response: userDetailSchema,
  successStatus: 200,
});

export const resendInvite = endpoint({
  method: "POST",
  path: "/users/:id/invite",
  summary: "Email a fresh invite to a user who hasn't accepted theirs",
  tag: "Users",
  auth: "session",
  permission: "identity:user:manage",
  resource: { type: "user", param: "id" },
  params: idParams,
  response: z.object({ emailSent: z.boolean() }),
  successStatus: 200,
});

export const assignRole = endpoint({
  method: "POST",
  path: "/users/:id/roles",
  summary: "Grant a staff role",
  tag: "Users",
  auth: "session",
  permission: "identity:role:manage",
  resource: { type: "user", param: "id" },
  params: idParams,
  body: z.object({ role: staffRole, reason }),
  response: roleAssignmentSchema,
});

export const revokeRole = endpoint({
  method: "DELETE",
  path: "/users/:id/roles/:assignmentId",
  summary: "Revoke a staff role",
  tag: "Users",
  auth: "session",
  permission: "identity:role:manage",
  resource: { type: "user", param: "id" },
  params: z.object({ id: z.uuid(), assignmentId: z.uuid() }),
  body: z.object({ reason }),
  response: z.object({}),
  successStatus: 204,
});
