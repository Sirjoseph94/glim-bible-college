import * as audit from "./audit";
import * as auth from "./auth";
import * as me from "./me";
import * as platform from "./platform";
import * as users from "./users";

export { audit, auth, me, platform, users };

/** Every endpoint, for the OpenAPI document and the route-coverage test. */
export const ENDPOINTS = [
  platform.getInstitution,
  me.getMe,
  auth.login,
  auth.logout,
  auth.forgotPassword,
  auth.resetPassword,
  auth.acceptInvite,
  users.listUsers,
  users.inviteUser,
  users.getUser,
  users.updateUser,
  users.deactivateUser,
  users.resendInvite,
  users.assignRole,
  users.revokeRole,
  audit.listAuditLogs,
] as const;
export type { AuditLogItem } from "./audit";
export type { Me } from "./me";
export type { UserDetail, UserListItem } from "./users";
