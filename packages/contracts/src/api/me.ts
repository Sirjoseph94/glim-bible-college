import { z } from "zod";
import { STAFF_ROLES } from "../enums";
import { endpoint } from "../http";
import { timeZone } from "./settings";
import { institutionSchema } from "./platform";

/** `GET /me` (§8.4): navigation data only; every action is re-authorized on the server (INV-1). */
export const meSchema = z.object({
  user: z.object({
    id: z.uuid(),
    displayName: z.string(),
    email: z.string(),
    /** Whether a Google account is linked (students need one before joining online, §8.1). */
    googleLinked: z.boolean(),
    /** The viewer's IANA zone; the institution's when the user hasn't set one. */
    timezone: z.string(),
    /** False until the user (or their browser, on first sign-in) has chosen a zone (§5.1). */
    timezoneSet: z.boolean(),
    /** Personal referral code (students, alumni and staff, §10.6); null for others. */
    referralCode: z.string().nullable(),
  }),
  institution: institutionSchema,
  roles: z.object({
    staff: z.array(z.enum(STAFF_ROLES)),
    isLecturer: z.boolean(),
    isStudent: z.boolean(),
    /** Graduated: no courses any more, but their own results and transcripts. */
    isAlumnus: z.boolean(),
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

export const updateMe = endpoint({
  method: "PATCH",
  path: "/me",
  summary: "Change your own name or timezone",
  tag: "Me",
  auth: "session",
  body: z
    .object({
      displayName: z.string().trim().min(1).max(120).optional(),
      timezone: timeZone.optional(),
    })
    .strict(),
  response: meSchema,
});
