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

/** Errors the Google callback reports back to the SPA as `?error=` on the page it returns to. */
export const GOOGLE_FAILURES = [
  "GOOGLE_UNAVAILABLE",
  "GOOGLE_SIGN_IN_FAILED",
  "GOOGLE_EMAIL_UNVERIFIED",
  "ACCOUNT_NOT_FOUND",
  "GOOGLE_DOMAIN_NOT_ALLOWED",
  "GOOGLE_ALREADY_LINKED",
] as const;

export const googleStart = endpoint({
  method: "GET",
  path: "/auth/google/start",
  summary: "Redirect to Google to sign in (or, signed in, to link a Google account)",
  tag: "Auth",
  auth: "public",
  rateLimit: "auth",
  query: z.object({
    intent: z.enum(["signin", "link"]).default("signin"),
    returnTo: z.string().max(512).optional(),
  }),
  response: z.object({}),
  successStatus: 302,
});

export const googleCallback = endpoint({
  method: "GET",
  path: "/auth/google/callback",
  summary: "Google's redirect back: completes sign-in or linking, then redirects into the app",
  tag: "Auth",
  auth: "public",
  rateLimit: "auth",
  query: z
    .object({ code: z.string().max(2048).optional(), state: z.string().max(512).optional() })
    .loose(),
  response: z.object({}),
  successStatus: 302,
});
