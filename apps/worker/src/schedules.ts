import { CRON_SCHEDULES, type CronName, type QueueName } from "@glim/contracts";
import type { PgBoss } from "pg-boss";

/**
 * Registers the cron schedules (TRD §17.2) for queues that have a handler, so no queue fills with
 * jobs nobody runs; schedules for queues without one are removed. Only the scheduler role calls this.
 */
export async function registerSchedules(
  boss: PgBoss,
  handled: ReadonlySet<QueueName>,
): Promise<void> {
  for (const name of Object.keys(CRON_SCHEDULES) as CronName[]) {
    const spec = CRON_SCHEDULES[name];
    if (!handled.has(spec.queue)) {
      await boss.unschedule(spec.queue, name);
      continue;
    }
    await boss.schedule(spec.queue, spec.cron, null, { tz: spec.tz, key: name });
  }
}
