import { createBoss, createPool, Db } from "@glim/db";
import { systemClock } from "@glim/shared";
import { loadConfig } from "@glim/shared/config";
import { createLogger } from "@glim/telemetry";
import { buildApp } from "./app";

const config = loadConfig();
const logger = createLogger({ service: "api", level: config.logLevel });

// The API only sends jobs (on the caller's transaction); it never polls, supervises or migrates.
const boss = createBoss(config.db.url, { max: 1 });
await boss.start();
const db = new Db(createPool(config.db.url, config.db.poolApi), boss);

const app = await buildApp({ config, db, boss, clock: systemClock, logger });
await app.listen(config.port, "0.0.0.0");
logger.info({ port: config.port }, "api listening");

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      await app.close();
      await boss.stop({ graceful: false });
      await db.pool.end();
      process.exit(0);
    })();
  });
}
