import { z } from "zod";
import { endpoint } from "../http";
import { meSchema } from "./me";

const email = z.email().max(254);
const token = z.string().min(20).max(128);
/** Length rules are enforced by the server's password policy so it can explain them. */
const password = z.string().min(1).max(1024);
const empty = z.object({});

export const login = endpoint({
  method: "POST",
  path: "/auth/login",
  summary: "Sign in with email and password (staff and imported students)",
  tag: "Auth",
  auth: "public",
  rateLimit: "auth",
  body: z.object({ email, password }),
  response: meSchema,
  successStatus: 200,
});

export const logout = endpoint({
  method: "POST",
  path: "/auth/logout",
  summary: "Sign out of this session",
  tag: "Auth",
  auth: "session",
  response: empty,
  successStatus: 204,
});

export const forgotPassword = endpoint({
  method: "POST",
  path: "/auth/password/forgot",
  summary: "Email a password-reset link (always succeeds)",
  tag: "Auth",
  auth: "public",
  rateLimit: "auth",
  body: z.object({ email }),
  response: empty,
  successStatus: 202,
});

export const resetPassword = endpoint({
  method: "POST",
  path: "/auth/password/reset",
  summary: "Set a new password from a reset link",
  tag: "Auth",
  auth: "public",
  rateLimit: "auth",
  body: z.object({ token, password }),
  response: empty,
  successStatus: 204,
});

export const acceptInvite = endpoint({
  method: "POST",
  path: "/auth/invite/accept",
  summary: "Accept an invite: set a password and sign in",
  tag: "Auth",
  auth: "public",
  rateLimit: "auth",
  body: z.object({ token, password }),
  response: meSchema,
  successStatus: 200,
});
