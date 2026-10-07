import type { QueueName } from "@glim/contracts";
import type { Job, PgBoss } from "pg-boss";

export type JobHandler = (job: Job) => Promise<unknown>;

/**
 * Runs queued jobs through their handlers until no queue has ready work, so background effects
 * complete inside a test. Failed jobs follow the queue's retry policy like in production.
 */
export async function drainQueues(
  boss: PgBoss,
  handlers: Partial<Record<QueueName, JobHandler>>,
  options: { maxRounds?: number } = {},
): Promise<{ completed: number; failed: number }> {
  const maxRounds = options.maxRounds ?? 50;
  let completed = 0;
  let failed = 0;
  for (let round = 0; round < maxRounds; round++) {
    let ranAny = false;
    for (const [queue, handler] of Object.entries(handlers) as [QueueName, JobHandler][]) {
      const jobs = await boss.fetch<object>(queue, { batchSize: 20 });
      for (const job of jobs) {
        ranAny = true;
        try {
          await handler(job);
          await boss.complete(queue, job.id);
          completed++;
        } catch (error) {
          await boss.fail(queue, job.id, {
            message: error instanceof Error ? error.message : String(error),
          });
          failed++;
        }
      }
    }
    if (!ranAny) return { completed, failed };
  }
  throw new Error(`Queues still had work after ${maxRounds} rounds`);
}
