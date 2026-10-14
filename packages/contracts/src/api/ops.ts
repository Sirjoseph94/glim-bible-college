import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

/** The System Admin's ops page and job dashboard (TRD §15.3, §20.1). */

const FAILURE_KINDS = [
  "provider-event",
  "video",
  "meeting-provision",
  "recording",
  "subscription",
  "email",
  "job",
] as const;

export const opsFailureSchema = z.object({
  kind: z.enum(FAILURE_KINDS),
  id: z.string(),
  label: z.string(),
  status: z.string(),
  detail: z.string().nullable(),
  occurredAt: z.iso.datetime(),
  replayable: z.boolean(),
});

export type OpsFailure = z.infer<typeof opsFailureSchema>;

export const queueStatSchema = z.object({
  name: z.string(),
  /** Waiting and due now. */
  queued: z.number().int(),
  active: z.number().int(),
  failedLastDay: z.number().int(),
  /** How long the oldest due job has waited; null when nothing waits. */
  oldestQueuedSeconds: z.number().int().nullable(),
  /** Older than 120 s: the System Admin is emailed. */
  behind: z.boolean(),
});

export type QueueStat = z.infer<typeof queueStatSchema>;

export const youTubeStatusSchema = z.object({
  checkedAt: z.iso.datetime(),
  ok: z.boolean(),
  reachable: z.boolean(),
  detail: z.string().nullable(),
  channels: z.array(
    z.object({ url: z.string(), resolves: z.boolean(), detail: z.string().nullable() }),
  ),
});

export type YouTubeStatus = z.infer<typeof youTubeStatusSchema>;

export const listOpsFailures = endpoint({
  method: "GET",
  path: "/admin/ops/failures",
  summary:
    "Failed provider events, unavailable videos, provisioning errors, suppressed email addresses and failed jobs",
  tag: "Ops",
  auth: "session",
  permission: "ops:failures:read",
  response: z.object({ items: z.array(opsFailureSchema) }),
});

export const replayOpsFailure = endpoint({
  method: "POST",
  path: "/admin/ops/replay/:kind/:id",
  summary:
    "Replay a failure: process an event again, recheck a video, resend a failed job, or stop suppressing an address",
  tag: "Ops",
  auth: "session",
  permission: "ops:failures:replay",
  params: z.object({ kind: z.enum(FAILURE_KINDS), id: z.string().min(1).max(100) }),
  response: z.object({ replayed: z.literal(true) }),
  successStatus: 202,
});

export const listQueues = endpoint({
  method: "GET",
  path: "/admin/jobs",
  summary: "Each job queue's depth and the age of its oldest waiting job",
  tag: "Ops",
  auth: "session",
  permission: "ops:failures:read",
  response: z.object({ items: z.array(queueStatSchema) }),
});

const integrationStatus = z.enum(ENUMS["integration_configs.status"]);

/** The app acting as GLIM's YouTube channel (integration slice, Appendix A.4 step 5). */
export const youTubeChannelSchema = z.object({
  /** VIDEO_HOST=youtube_api: recordings can be uploaded once the channel is connected. */
  uploadsEnabled: z.boolean(),
  connected: z.boolean(),
  status: integrationStatus.nullable(),
  channel: z.object({ id: z.string(), title: z.string(), url: z.string() }).nullable(),
  lastError: z.string().nullable(),
});

export const getYouTubeStatus = endpoint({
  method: "GET",
  path: "/admin/integrations/youtube/status",
  summary:
    "The last YouTube check (oEmbed reachable, channel URLs resolving) and the channel connection",
  tag: "Ops",
  auth: "session",
  permission: "ops:integration:manage",
  response: z.object({ status: youTubeStatusSchema.nullable(), channel: youTubeChannelSchema }),
});

export const connectYouTube = endpoint({
  method: "GET",
  path: "/admin/integrations/youtube/connect",
  summary: "Redirect to Google to let the app manage GLIM's YouTube channel",
  tag: "Ops",
  auth: "session",
  permission: "ops:integration:manage",
  response: z.object({}),
  successStatus: 302,
});

export const youTubeCallback = endpoint({
  method: "GET",
  path: "/admin/integrations/youtube/callback",
  summary: "Google's redirect back after consent: stores the channel's grant",
  tag: "Ops",
  auth: "session",
  permission: "ops:integration:manage",
  query: z
    .object({
      code: z.string().max(2048).optional(),
      state: z.string().max(512).optional(),
      error: z.string().max(200).optional(),
    })
    .loose(),
  response: z.object({}),
  successStatus: 302,
});

export const disconnectYouTube = endpoint({
  method: "POST",
  path: "/admin/integrations/youtube/disconnect",
  summary: "Forget the channel's grant; uploads stop until it is connected again",
  tag: "Ops",
  auth: "session",
  permission: "ops:integration:manage",
  response: youTubeChannelSchema,
});

const circuit = z.enum(["CLOSED", "OPEN", "HALF_OPEN"]);

export const hostAccountSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  /** The account's numeric Google id; its event subscription needs it. */
  providerUserId: z.string().nullable(),
  status: z.enum(ENUMS["provider_host_accounts.status"]),
  weight: z.number().int(),
  subscription: z
    .object({
      status: z.enum(ENUMS["provider_subscriptions.status"]),
      expiresAt: z.iso.datetime().nullable(),
      lastError: z.string().nullable(),
    })
    .nullable(),
  /** OPEN: calls for this account are paused after repeated failures. */
  circuit,
});

export type HostAccount = z.infer<typeof hostAccountSchema>;

export const googleCheckSchema = z.object({
  checkedAt: z.iso.datetime(),
  ok: z.boolean(),
  detail: z.string().nullable(),
  hosts: z.array(
    z.object({
      email: z.string(),
      ok: z.boolean(),
      detail: z.string().nullable(),
      permissions: z.array(
        z.object({ permission: z.string(), granted: z.boolean(), detail: z.string().nullable() }),
      ),
      storage: z.object({ usedBytes: z.number(), limitBytes: z.number().nullable() }).nullable(),
    }),
  ),
  subscriptions: z.object({
    created: z.number().int(),
    renewed: z.number().int(),
    failed: z.number().int(),
    missingUserId: z.array(z.string()),
  }),
});

export const googleIntegrationSchema = z.object({
  /** LIVE_PROVIDER: `none` keeps pasted Meet links (v1). */
  mode: z.enum(["none", "google_meet", "fake"]),
  status: integrationStatus.nullable(),
  lastError: z.string().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  primaryDomain: z.string().nullable(),
  /** What the Admin Console's domain-wide delegation entry needs (Appendix A.2 step 4). */
  serviceAccount: z.object({ clientEmail: z.string(), clientId: z.string() }).nullable(),
  delegationScopes: z.array(z.string()),
  pubsubSubscription: z.string().nullable(),
  pubsubTopic: z.string().nullable(),
  hostAccounts: z.array(hostAccountSchema),
  lastCheck: googleCheckSchema.nullable(),
});

export type GoogleIntegration = z.infer<typeof googleIntegrationSchema>;

export const getGoogleIntegration = endpoint({
  method: "GET",
  path: "/admin/integrations/google",
  summary: "The Google Meet integration: setup values, host accounts, subscriptions, last test",
  tag: "Ops",
  auth: "session",
  permission: "ops:integration:manage",
  response: googleIntegrationSchema,
});

export const saveGoogleIntegration = endpoint({
  method: "POST",
  path: "/admin/integrations/google",
  summary: "Save the Google Workspace settings that aren't secrets",
  tag: "Ops",
  auth: "session",
  permission: "ops:integration:manage",
  body: z.object({ primaryDomain: z.string().trim().min(3).max(253).nullable() }).strict(),
  response: googleIntegrationSchema,
});

export const testGoogleIntegration = endpoint({
  method: "POST",
  path: "/admin/integrations/google/test",
  summary:
    "Test Google now (in the background): tokens, delegated scopes, Drive storage, subscriptions",
  tag: "Ops",
  auth: "session",
  permission: "ops:integration:manage",
  response: z.object({}),
  successStatus: 202,
});

export const addHostAccount = endpoint({
  method: "POST",
  path: "/admin/integrations/google/host-accounts",
  summary: "Add a Workspace account that owns Meet spaces (TRD §11.2)",
  tag: "Ops",
  auth: "session",
  permission: "ops:integration:manage",
  body: z
    .object({
      email: z.email().max(254),
      providerUserId: z
        .string()
        .regex(/^\d{5,30}$/)
        .nullable()
        .default(null),
      weight: z.number().int().min(1).max(10).default(1),
    })
    .strict(),
  response: hostAccountSchema,
  successStatus: 201,
});

export const updateHostAccount = endpoint({
  method: "PATCH",
  path: "/admin/integrations/google/host-accounts/:id",
  summary: "Change a host account: its Google id, weight, or take it out of use",
  tag: "Ops",
  auth: "session",
  permission: "ops:integration:manage",
  params: z.object({ id: z.uuid() }),
  body: z
    .object({
      providerUserId: z
        .string()
        .regex(/^\d{5,30}$/)
        .nullable()
        .optional(),
      weight: z.number().int().min(1).max(10).optional(),
      status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    })
    .strict(),
  response: hostAccountSchema,
});

export const testYouTube = endpoint({
  method: "POST",
  path: "/admin/integrations/youtube/test",
  summary: "Check YouTube now (in the background; reload the status in a moment)",
  tag: "Ops",
  auth: "session",
  permission: "ops:integration:manage",
  response: z.object({}),
  successStatus: 202,
});
