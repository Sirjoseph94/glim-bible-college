import { loadConfig } from "@glim/shared/config";
import { createLogger } from "@glim/telemetry";
import { migrateDatabase } from "../migrate";

const config = loadConfig();
const log = createLogger({ service: "migrate", level: config.logLevel });

try {
  await migrateDatabase({ migratorUrl: config.db.migratorUrl });
  log.info("migrations applied");
} catch (error) {
  log.error({ err: error }, "migrations failed");
  process.exitCode = 1;
}
