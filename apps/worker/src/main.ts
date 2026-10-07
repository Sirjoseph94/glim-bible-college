import { createBoss } from "@glim/db";
import { loadConfig } from "@glim/shared/config";
import { createLogger } from "@glim/telemetry";
import { createHandlers } from "./handlers";
import { subscribers } from "./subscribers";
import { runsScheduler, startWorker } from "./worker";

const config = loadConfig();
const logger = createLogger({ service: "worker", level: config.logLevel });
const scheduler = runsScheduler(config.workerRole);

// pg-boss polls and supervises over the direct connection (no pooler), TRD §5.2.
const boss = createBoss(config.db.directUrl, {
  max: config.db.poolBoss,
  supervise: scheduler,
  schedule: scheduler,
});

const worker = await startWorker({
  boss,
  role: config.workerRole,
  handlers: createHandlers({ subscribers }),
  logger,
  concurrency: config.queueConcurrency,
});

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
    worker.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, "shutdown failed");
        process.exit(1);
      },
    );
  });
}
