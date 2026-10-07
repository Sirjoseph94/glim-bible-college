import { createBoss, createPool, Db } from "@glim/db";
import { createMailer } from "@glim/integrations/mail/factory";
import { systemClock } from "@glim/shared";
import { loadConfig } from "@glim/shared/config";
import { createLogger } from "@glim/telemetry";
import { createHandlers } from "./handlers";
import { subscribers } from "./subscribers";
import { runsScheduler, startWorker } from "./worker";
import { createWorkerContext } from "./worker.module";

const config = loadConfig();
const logger = createLogger({ service: "worker", level: config.logLevel });
const scheduler = runsScheduler(config.workerRole);

// pg-boss polls and supervises over the direct connection (no pooler), TRD §5.2.
const boss = createBoss(config.db.directUrl, {
  max: config.db.poolBoss,
  supervise: scheduler,
  schedule: scheduler,
});
// Handlers write through the transaction-mode pool, sending follow-up jobs on their transaction.
const db = new Db(createPool(config.db.url, config.db.poolWorker), boss);
const context = await createWorkerContext({
  db,
  clock: systemClock,
  logger,
  config,
  mailer: createMailer(config),
});

const worker = await startWorker({
  boss,
  role: config.workerRole,
  handlers: createHandlers({ context, subscribers }),
  logger,
  concurrency: config.queueConcurrency,
});

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
    void (async () => {
      try {
        await worker.stop();
        await context.close();
        await db.pool.end();
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, "shutdown failed");
        process.exit(1);
      }
    })();
  });
}
