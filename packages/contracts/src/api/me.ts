import { z } from "zod";
import { STAFF_ROLES } from "../enums";
import { endpoint } from "../http";
import { institutionSchema } from "./platform";

/** `GET /me` (§8.4): navigation data only; every action is re-authorized on the server (INV-1). */
export const meSchema = z.object({
  user: z.object({
    id: z.uuid(),
    displayName: z.string(),
    email: z.string(),
    /** The viewer's IANA zone; the institution's when the user hasn't set one. */
    timezone: z.string(),
  }),
  institution: institutionSchema,
  roles: z.object({
    staff: z.array(z.enum(STAFF_ROLES)),
    isLecturer: z.boolean(),
    isStudent: z.boolean(),
    isApplicant: z.boolean(),
  }),
  csrfToken: z.string(),
  featureFlags: z.record(z.string(), z.boolean()),
});

export type Me = z.infer<typeof meSchema>;

export const getMe = endpoint({
  method: "GET",
  path: "/me",
  summary: "The signed-in user, their roles and CSRF token",
  tag: "Me",
  auth: "session",
  response: meSchema,
});
