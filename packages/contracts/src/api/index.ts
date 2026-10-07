import * as auth from "./auth";
import * as me from "./me";
import * as platform from "./platform";

export { auth, me, platform };

/** Every endpoint, for the OpenAPI document and the route-coverage test. */
export const ENDPOINTS = [
  platform.getInstitution,
  me.getMe,
  auth.login,
  auth.logout,
  auth.forgotPassword,
  auth.resetPassword,
  auth.acceptInvite,
] as const;
export type { Me } from "./me";
