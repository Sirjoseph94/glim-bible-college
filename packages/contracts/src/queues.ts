/**
 * Queue catalogue (TRD §17.1) and cron schedules (§17.2).
 * `ensureQueues()` creates every queue whose `slice` is "v1"; integration-slice queues are
 * registered here so their names are reserved, but they're created by the Google integration slice.
 */
export const WORKER_ROLES = ["general", "google", "media", "scheduler", "all"] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

export interface QueueSpec {
  role: Exclude<WorkerRole, "all">;
  retryLimit: number;
  expireInSeconds: number;
  slice: "v1" | "integration";
}

const MIN = 60;
const HOUR = 60 * MIN;

export const QUEUES = {
  "class-meeting.provision": {
    role: "google",
    retryLimit: 6,
    expireInSeconds: 5 * MIN,
    slice: "integration",
  },
  "class-meeting.sync-access": {
    role: "google",
    retryLimit: 6,
    expireInSeconds: 10 * MIN,
    slice: "integration",
  },
  "class-meeting.end": {
    role: "google",
    retryLimit: 3,
    expireInSeconds: 2 * MIN,
    slice: "integration",
  },
  "class-meeting.finalize": {
    role: "general",
    retryLimit: 5,
    expireInSeconds: 10 * MIN,
    slice: "v1",
  },
  "conference.sync": {
    role: "google",
    retryLimit: 6,
    expireInSeconds: 15 * MIN,
    slice: "integration",
  },
  "provider-event.process": {
    role: "general",
    retryLimit: 5,
    expireInSeconds: 2 * MIN,
    slice: "v1",
  },
  "attendance.recompute": { role: "general", retryLimit: 3, expireInSeconds: 2 * MIN, slice: "v1" },
  "recording.discover": {
    role: "general",
    retryLimit: 6,
    expireInSeconds: 5 * MIN,
    slice: "integration",
  },
  "recording.ingest": {
    role: "media",
    retryLimit: 5,
    expireInSeconds: 2 * HOUR,
    slice: "integration",
  },
  "video.youtube-processing-sync": {
    role: "general",
    retryLimit: 20,
    expireInSeconds: 2 * MIN,
    slice: "integration",
  },
  "video.availability-check": {
    role: "general",
    retryLimit: 3,
    expireInSeconds: 30 * MIN,
    slice: "v1",
  },
  "drive.cleanup": {
    role: "google",
    retryLimit: 5,
    expireInSeconds: 5 * MIN,
    slice: "integration",
  },
  "video.purge-deleted": { role: "general", retryLimit: 3, expireInSeconds: 30 * MIN, slice: "v1" },
  "quiz.expire": { role: "general", retryLimit: 3, expireInSeconds: 2 * MIN, slice: "v1" },
  "import.run": { role: "general", retryLimit: 2, expireInSeconds: HOUR, slice: "v1" },
  /** One invite email; imports spread these out with `startAfter` (rate cap). */
  "identity.invite": { role: "general", retryLimit: 3, expireInSeconds: 2 * MIN, slice: "v1" },
  /** Daily: generates each active series' Class Meetings up to the 8-week horizon (§11.9). */
  "class-meeting.series-extend": {
    role: "general",
    retryLimit: 3,
    expireInSeconds: 10 * MIN,
    slice: "v1",
  },
  "semester.open-registration": {
    role: "general",
    retryLimit: 3,
    expireInSeconds: 30 * MIN,
    slice: "v1",
  },
  "academic.progression": {
    role: "general",
    retryLimit: 3,
    expireInSeconds: 30 * MIN,
    slice: "v1",
  },
  "results.compute-semester": {
    role: "general",
    retryLimit: 3,
    expireInSeconds: 30 * MIN,
    slice: "v1",
  },
  "transcript.generate": { role: "general", retryLimit: 3, expireInSeconds: 10 * MIN, slice: "v1" },
  "transcript.send": { role: "general", retryLimit: 3, expireInSeconds: 10 * MIN, slice: "v1" },
  "admissions.offer-sweep": {
    role: "general",
    retryLimit: 3,
    expireInSeconds: 10 * MIN,
    slice: "v1",
  },
  "admissions.intake-status": {
    role: "general",
    retryLimit: 3,
    expireInSeconds: 5 * MIN,
    slice: "v1",
  },
  "admissions.purge": { role: "general", retryLimit: 2, expireInSeconds: 30 * MIN, slice: "v1" },
  "notify.send": { role: "general", retryLimit: 5, expireInSeconds: 2 * MIN, slice: "v1" },
  "notify.digest": { role: "general", retryLimit: 5, expireInSeconds: 2 * MIN, slice: "v1" },
  "domain-event": { role: "general", retryLimit: 5, expireInSeconds: 2 * MIN, slice: "v1" },
  "subscription.renew": {
    role: "google",
    retryLimit: 6,
    expireInSeconds: 5 * MIN,
    slice: "integration",
  },
  "db.logical-backup": { role: "scheduler", retryLimit: 2, expireInSeconds: HOUR, slice: "v1" },
  "ops.queue-health": { role: "general", retryLimit: 0, expireInSeconds: MIN, slice: "v1" },
  "ops.youtube-check": { role: "general", retryLimit: 2, expireInSeconds: 2 * MIN, slice: "v1" },
  "idempotency.cleanup": {
    role: "scheduler",
    retryLimit: 2,
    expireInSeconds: 10 * MIN,
    slice: "v1",
  },
  "auth.session-cleanup": {
    role: "scheduler",
    retryLimit: 2,
    expireInSeconds: 10 * MIN,
    slice: "v1",
  },
  "meeting.tick": { role: "general", retryLimit: 2, expireInSeconds: MIN, slice: "v1" },
} as const satisfies Record<string, QueueSpec>;

export type QueueName = keyof typeof QUEUES;
export const QUEUE_NAMES = Object.keys(QUEUES) as QueueName[];

export function deadLetterQueue(queue: QueueName): string {
  return `${queue}.dlq`;
}

/** Which queues a worker with the given role processes. `all` processes every role. */
export function queuesForRole(role: WorkerRole): QueueName[] {
  return QUEUE_NAMES.filter(
    (q) => QUEUES[q].slice === "v1" && (role === "all" || QUEUES[q].role === role),
  );
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
  "video.purge-deleted": { queue: "video.purge-deleted", cron: "30 3 * * *", tz: "UTC" },
  "video.availability-check": { queue: "video.availability-check", cron: "0 4 * * *", tz: "UTC" },
  "notify.digest": { queue: "notify.digest", cron: "0 6 * * *", tz: "Africa/Lagos" },
  "admissions.offer-sweep": { queue: "admissions.offer-sweep", cron: "0 * * * *", tz: "UTC" },
  "idempotency.cleanup": { queue: "idempotency.cleanup", cron: "15 * * * *", tz: "UTC" },
  "auth.session-cleanup": { queue: "auth.session-cleanup", cron: "45 * * * *", tz: "UTC" },
  "db.logical-backup": { queue: "db.logical-backup", cron: "0 1 * * 0", tz: "UTC" },
  "ops.queue-health": { queue: "ops.queue-health", cron: "* * * * *", tz: "UTC" },
} as const satisfies Record<string, CronSpec>;

export type CronName = keyof typeof CRON_SCHEDULES;
