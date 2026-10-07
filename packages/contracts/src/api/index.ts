import * as audit from "./audit";
import * as auth from "./auth";
import * as me from "./me";
import * as platform from "./platform";
import * as settings from "./settings";
import * as users from "./users";

export { audit, auth, me, platform, settings, users };

/** Every endpoint, for the OpenAPI document and the route-coverage test. */
export const ENDPOINTS = [
  platform.getInstitution,
  me.getMe,
  me.updateMe,
  auth.login,
  auth.logout,
  auth.forgotPassword,
  auth.resetPassword,
  auth.acceptInvite,
  auth.googleStart,
  auth.googleCallback,
  users.listUsers,
  users.inviteUser,
  users.getUser,
  users.updateUser,
  users.deactivateUser,
  users.resendInvite,
  users.assignRole,
  users.revokeRole,
  audit.listAuditLogs,
  settings.getSettings,
  settings.updateSettings,
  settings.listPolicies,
  settings.getPolicy,
  settings.putPolicy,
] as const;
export type { AuditLogItem } from "./audit";
export type { Me } from "./me";
export type { PolicyView, Settings } from "./settings";
export type { UserDetail, UserListItem } from "./users";
