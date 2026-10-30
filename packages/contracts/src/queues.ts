/**
 * Queue catalogue (TRD §17.1) and cron schedules (§17.2). `ensureQueues()` creates every queue;
 * a worker only works the queues it has handlers for, so the Google queues stay idle while
 * `LIVE_PROVIDER=none`.
 */
export const WORKER_ROLES = ["general", "google", "media", "scheduler", "all"] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

export interface QueueSpec {
  role: Exclude<WorkerRole, "all">;
  retryLimit: number;
  expireInSeconds: number;
}

const MIN = 60;
const HOUR = 60 * MIN;

export const QUEUES = {
  "class-meeting.provision": {
    role: "google",
    retryLimit: 6,
    expireInSeconds: 5 * MIN,
  },
  "class-meeting.sync-access": {
    role: "google",
    retryLimit: 6,
    expireInSeconds: 10 * MIN,
  },
  "class-meeting.end": {
    role: "google",
    retryLimit: 3,
    expireInSeconds: 2 * MIN,
  },
  "class-meeting.finalize": {
    role: "general",
    retryLimit: 5,
    expireInSeconds: 10 * MIN,
  },
  "conference.sync": {
    role: "google",
    retryLimit: 6,
    expireInSeconds: 15 * MIN,
  },
  "provider-event.process": {
    role: "general",
    retryLimit: 5,
    expireInSeconds: 2 * MIN,
  },
  "attendance.recompute": { role: "general", retryLimit: 3, expireInSeconds: 2 * MIN },
  "recording.discover": {
    role: "general",
    retryLimit: 6,
    expireInSeconds: 5 * MIN,
  },
  "recording.ingest": {
    role: "media",
    retryLimit: 5,
    expireInSeconds: 2 * HOUR,
  },
  "video.youtube-processing-sync": {
    role: "general",
    retryLimit: 20,
    expireInSeconds: 2 * MIN,
  },
  "video.availability-check": {
    role: "general",
    retryLimit: 3,
    expireInSeconds: 30 * MIN,
  },
  /** Every 10 minutes: Meet recordings the events missed, and stuck uploads (§11.8). */
  "recording.reconcile": { role: "google", retryLimit: 1, expireInSeconds: 10 * MIN },
  /** A video's title changed in the app: change it on YouTube too (integration slice). */
  "video.youtube-metadata": { role: "general", retryLimit: 5, expireInSeconds: 2 * MIN },
  "drive.cleanup": {
    role: "google",
    retryLimit: 5,
    expireInSeconds: 5 * MIN,
  },
  "video.purge-deleted": { role: "general", retryLimit: 3, expireInSeconds: 30 * MIN },
  "quiz.expire": { role: "general", retryLimit: 3, expireInSeconds: 2 * MIN },
  "import.run": { role: "general", retryLimit: 2, expireInSeconds: HOUR },
  /** One invite email; imports spread these out with `startAfter` (rate cap). */
  "identity.invite": { role: "general", retryLimit: 3, expireInSeconds: 2 * MIN },
  /** Daily: generates each active series' Class Meetings up to the 8-week horizon (§11.9). */
  "class-meeting.series-extend": {
    role: "general",
    retryLimit: 3,
    expireInSeconds: 10 * MIN,
  },
  /** Daily: offerings start and complete on their dates (ADR-0005). */
  "academic.offering-lifecycle": {
    role: "general",
    retryLimit: 3,
    expireInSeconds: 30 * MIN,
  },
  "transcript.generate": { role: "general", retryLimit: 3, expireInSeconds: 10 * MIN },
  "transcript.send": { role: "general", retryLimit: 3, expireInSeconds: 10 * MIN },
  "admissions.offer-sweep": {
    role: "general",
    retryLimit: 3,
    expireInSeconds: 10 * MIN,
  },
  "admissions.intake-status": {
    role: "general",
    retryLimit: 3,
    expireInSeconds: 5 * MIN,
  },
  "admissions.purge": { role: "general", retryLimit: 2, expireInSeconds: 30 * MIN },
  "notify.send": { role: "general", retryLimit: 5, expireInSeconds: 2 * MIN },
  "notify.digest": { role: "general", retryLimit: 5, expireInSeconds: 2 * MIN },
  "domain-event": { role: "general", retryLimit: 5, expireInSeconds: 2 * MIN },
  "subscription.renew": {
    role: "google",
    retryLimit: 6,
    expireInSeconds: 5 * MIN,
  },
  "db.logical-backup": { role: "scheduler", retryLimit: 2, expireInSeconds: HOUR },
  "ops.queue-health": { role: "general", retryLimit: 0, expireInSeconds: MIN },
  "ops.youtube-check": { role: "general", retryLimit: 2, expireInSeconds: 2 * MIN },
  /** The admin's "Test Google": tokens, delegated scopes, Drive storage, subscriptions (§15.3). */
  "ops.google-check": { role: "google", retryLimit: 1, expireInSeconds: 5 * MIN },
  /** Hourly: the host accounts' Drive storage, alerting at 70 % and 85 % (§11.2). */
  "drive.storage-monitor": { role: "google", retryLimit: 1, expireInSeconds: 5 * MIN },
  "idempotency.cleanup": {
    role: "scheduler",
    retryLimit: 2,
    expireInSeconds: 10 * MIN,
  },
  "auth.session-cleanup": {
    role: "scheduler",
    retryLimit: 2,
    expireInSeconds: 10 * MIN,
  },
  "meeting.tick": { role: "general", retryLimit: 2, expireInSeconds: MIN },
  /** Every 3 minutes: Meet conferences the events missed (§11.8, INV-6). */
  "meeting.reconcile": { role: "google", retryLimit: 1, expireInSeconds: 3 * MIN },
} as const satisfies Record<string, QueueSpec>;

export type QueueName = keyof typeof QUEUES;
export const QUEUE_NAMES = Object.keys(QUEUES) as QueueName[];

export function deadLetterQueue(queue: QueueName): string {
  return `${queue}.dlq`;
}

/** Which queues a worker with the given role processes. `all` processes every role. */
export function queuesForRole(role: WorkerRole): QueueName[] {
  return QUEUE_NAMES.filter((q) => role === "all" || QUEUES[q].role === role);
}

export interface CronSpec {
  queue: QueueName;
  cron: string;
  tz: "UTC" | "Africa/Lagos";
}

/** Cron schedules (§17.2) whose queues exist in v1. Registered only by the `scheduler` role. */
export const CRON_SCHEDULES = {
  "meeting-tick": { queue: "meeting.tick", cron: "* * * * *", tz: "UTC" },
  "admissions.intake-status": {
    queue: "admissions.intake-status",
    cron: "5 0 * * *",
    tz: "Africa/Lagos",
  },
  "admissions.purge": { queue: "admissions.purge", cron: "0 3 * * *", tz: "UTC" },
  "class-meeting.series-extend": {
    queue: "class-meeting.series-extend",
    cron: "15 0 * * *",
    tz: "Africa/Lagos",
  },
  "academic.offering-lifecycle": {
    queue: "academic.offering-lifecycle",
    cron: "10 0 * * *",
    tz: "Africa/Lagos",
  },
  "video.purge-deleted": { queue: "video.purge-deleted", cron: "30 3 * * *", tz: "UTC" },
  "video.availability-check": { queue: "video.availability-check", cron: "0 4 * * *", tz: "UTC" },
  "notify.digest": { queue: "notify.digest", cron: "0 6 * * *", tz: "Africa/Lagos" },
  "admissions.offer-sweep": { queue: "admissions.offer-sweep", cron: "0 * * * *", tz: "UTC" },
  "idempotency.cleanup": { queue: "idempotency.cleanup", cron: "15 * * * *", tz: "UTC" },
  "auth.session-cleanup": { queue: "auth.session-cleanup", cron: "45 * * * *", tz: "UTC" },
  "db.logical-backup": { queue: "db.logical-backup", cron: "0 1 * * 0", tz: "UTC" },
  "ops.queue-health": { queue: "ops.queue-health", cron: "* * * * *", tz: "UTC" },
  "meeting-reconciliation": { queue: "meeting.reconcile", cron: "*/3 * * * *", tz: "UTC" },
  "subscription-renewal": { queue: "subscription.renew", cron: "*/15 * * * *", tz: "UTC" },
  "recording-reconciliation": { queue: "recording.reconcile", cron: "*/10 * * * *", tz: "UTC" },
  "drive-storage-monitor": { queue: "drive.storage-monitor", cron: "20 * * * *", tz: "UTC" },
} as const satisfies Record<string, CronSpec>;

export type CronName = keyof typeof CRON_SCHEDULES;
