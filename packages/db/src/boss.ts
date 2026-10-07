import { QUEUES, deadLetterQueue, type QueueName } from "@glim/contracts";
import { PgBoss, type ConstructorOptions } from "pg-boss";

export const BOSS_SCHEMA = "pgboss";

const DAY = 86_400;

/** Queue options (TRD §5.6, §17.1): retries with backoff, a dead-letter queue, archive/delete windows. */
export function queueOptions(queue: QueueName) {
  const spec = QUEUES[queue];
  return {
    retryLimit: spec.retryLimit,
    retryBackoff: true,
    expireInSeconds: spec.expireInSeconds,
    retentionSeconds: 7 * DAY,
    deleteAfterSeconds: 30 * DAY,
    deadLetter: deadLetterQueue(queue),
  };
}

/** Creates every v1 queue and its dead-letter queue if missing. Idempotent. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  const existing = new Set((await boss.getQueues()).map((q) => q.name));
  for (const queue of Object.keys(QUEUES) as QueueName[]) {
    if (QUEUES[queue].slice !== "v1") continue;
    const dlq = deadLetterQueue(queue);
    if (!existing.has(dlq)) await boss.createQueue(dlq, { retentionSeconds: 30 * DAY });
    if (!existing.has(queue)) await boss.createQueue(queue, queueOptions(queue));
  }
}

type BossOptions = Omit<ConstructorOptions, "connectionString" | "schema">;

/**
 * A pg-boss instance. Runtime processes never migrate the pg-boss schema (the `migrate` job
 * does, §5.6); only the scheduler role supervises and runs cron.
 */
export function createBoss(connectionString: string, options: BossOptions = {}): PgBoss {
  return new PgBoss({
    connectionString,
    schema: BOSS_SCHEMA,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    reindex: false,
    ...options,
  });
}
