import { CRON_SCHEDULES, type CronName } from "@glim/contracts";
import type { PgBoss } from "pg-boss";

/** Registers the cron schedules (TRD §17.2). Only the scheduler role calls this. */
export async function registerSchedules(boss: PgBoss): Promise<void> {
  for (const name of Object.keys(CRON_SCHEDULES) as CronName[]) {
    const spec = CRON_SCHEDULES[name];
    await boss.schedule(spec.queue, spec.cron, null, { tz: spec.tz, key: name });
  }
}
