import { z } from "zod";
import { endpoint } from "../http";

/** The System Admin's ops page and job dashboard (TRD §15.3, §20.1). */

const FAILURE_KINDS = ["provider-event", "video", "meeting-provision", "email", "job"] as const;

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

export const getYouTubeStatus = endpoint({
  method: "GET",
  path: "/admin/integrations/youtube/status",
  summary: "The last YouTube check: oEmbed reachable, configured channel URLs resolving",
  tag: "Ops",
  auth: "session",
  permission: "ops:integration:manage",
  response: z.object({ status: youTubeStatusSchema.nullable() }),
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
