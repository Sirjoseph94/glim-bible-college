import { queuesForRole, type QueueName, type WorkerRole } from "@glim/contracts";
import { ensureQueues } from "@glim/db";
import type { Logger } from "@glim/telemetry";
import type { PgBoss } from "pg-boss";
import type { HandlerRegistry } from "./handlers";
import { registerSchedules } from "./schedules";

export interface WorkerOptions {
  boss: PgBoss;
  role: WorkerRole;
  handlers: HandlerRegistry;
  logger: Logger;
  concurrency?: Partial<Record<string, number>>;
  pollingIntervalSeconds?: number;
}

export interface RunningWorker {
  queues: string[];
  /** Stops polling and waits up to `timeoutMs` for in-flight jobs (deploys restart workers, §5.6). */
  stop(options?: { graceful?: boolean; timeoutMs?: number }): Promise<void>;
}

export function runsScheduler(role: WorkerRole): boolean {
  return role === "scheduler" || role === "all";
}

/** Starts pg-boss for a worker role: ensures queues, registers cron (scheduler only) and handlers. */
export async function startWorker(options: WorkerOptions): Promise<RunningWorker> {
  const { boss, role, handlers, logger } = options;
  boss.on("error", (error) => {
    logger.error({ err: error }, "pg-boss error");
  });

  await boss.start();
  await ensureQueues(boss);
  if (runsScheduler(role)) {
    const handled = new Set(
      (Object.keys(handlers) as QueueName[]).filter((q) => handlers[q] !== undefined),
    );
    await registerSchedules(boss, handled);
  }

  const queues = queuesForRole(role).filter((queue) => handlers[queue] !== undefined);
  for (const queue of queues) {
    const handler = handlers[queue];
    if (handler === undefined) continue;
    await boss.work<object>(
      queue,
      {
        batchSize: 1,
        localConcurrency: options.concurrency?.[queue] ?? 1,
        ...(options.pollingIntervalSeconds === undefined
          ? {}
          : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
      },
      async (jobs) => {
        for (const job of jobs) {
          const started = Date.now();
          const log = logger.child({ jobId: job.id, queue, attempt: job.retryCount + 1 });
          try {
            await handler(job);
            log.info({ durationMs: Date.now() - started }, "job completed");
          } catch (error) {
            log.warn({ err: error, durationMs: Date.now() - started }, "job failed");
            throw error;
          }
        }
      },
    );
  }
  logger.info({ role, queues }, "worker started");

  return {
    queues,
    stop: async ({ graceful = true, timeoutMs = 25_000 } = {}) => {
      await boss.stop({ graceful, timeout: timeoutMs });
      logger.info({ graceful }, "worker stopped");
    },
  };
}
