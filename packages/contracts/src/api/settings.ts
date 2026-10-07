import { z } from "zod";
import { endpoint } from "../http";
import { EDITABLE_POLICY_TYPES } from "../policies";

/** An IANA timezone the runtime knows (validated with Intl, so no tz database ships). */
export const timeZone = z
  .string()
  .min(1)
  .max(64)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone");

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    "Not a domain name",
  );

/** GLIM's YouTube channel(s) whose videos may be linked (§13.3): handle or channel-id URLs. */
const youtubeChannelUrl = z
  .string()
  .trim()
  .transform((url) => url.replace(/\/+$/, ""))
  .pipe(
    z
      .string()
      .regex(
        /^https:\/\/www\.youtube\.com\/(@[A-Za-z0-9._-]{3,30}|channel\/UC[A-Za-z0-9_-]{22})$/,
        "Use https://www.youtube.com/@handle or https://www.youtube.com/channel/UC…",
      ),
  );

export const settingsSchema = z.object({
  name: z.string(),
  timezone: z.string(),
  staffEmailDomains: z.array(z.string()),
  statementOfFaithUrl: z.string().nullable(),
  youtubeChannelUrls: z.array(z.string()),
  version: z.number().int(),
  updatedAt: z.iso.datetime(),
});

export type Settings = z.infer<typeof settingsSchema>;

export const getSettings = endpoint({
  method: "GET",
  path: "/settings",
  summary: "Institution settings",
  tag: "Settings",
  auth: "session",
  permission: "identity:policy:manage",
  response: settingsSchema,
});

export const updateSettings = endpoint({
  method: "PATCH",
  path: "/settings",
  summary: "Change institution settings",
  tag: "Settings",
  auth: "session",
  permission: "identity:policy:manage",
  ifMatch: true,
  body: z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      timezone: timeZone.optional(),
      staffEmailDomains: z.array(domain).max(10).optional(),
      statementOfFaithUrl: z
        .url({ protocol: /^https$/ })
        .max(500)
        .nullable()
        .optional(),
      youtubeChannelUrls: z.array(youtubeChannelUrl).max(10).optional(),
    })
    .strict(),
  response: settingsSchema,
});

const policyType = z.enum(EDITABLE_POLICY_TYPES as [string, ...string[]]);

export const policySchema = z.object({
  type: policyType,
  /** 0 until someone saves a version; the defaults apply until then. */
  version: z.number().int(),
  config: z.record(z.string(), z.unknown()),
  effectiveFrom: z.iso.datetime().nullable(),
  createdBy: z.uuid().nullable(),
});

export type PolicyView = z.infer<typeof policySchema>;

export const listPolicies = endpoint({
  method: "GET",
  path: "/policies",
  summary: "The current version of every institution policy",
  tag: "Settings",
  auth: "session",
  permission: "identity:policy:manage",
  response: z.object({ items: z.array(policySchema) }),
});

export const getPolicy = endpoint({
  method: "GET",
  path: "/policies/:type",
  summary: "The current version of one institution policy",
  tag: "Settings",
  auth: "session",
  permission: "identity:policy:manage",
  params: z.object({ type: policyType }),
  response: policySchema,
});

export const putPolicy = endpoint({
  method: "PUT",
  path: "/policies/:type",
  summary: "Save a new version of a policy (versions are append-only)",
  tag: "Settings",
  auth: "session",
  permission: "identity:policy:manage",
  ifMatch: true,
  params: z.object({ type: policyType }),
  /** Checked against that policy's schema on the server (contracts POLICY_SCHEMAS). */
  body: z.object({ config: z.record(z.string(), z.unknown()) }).strict(),
  response: policySchema,
});
