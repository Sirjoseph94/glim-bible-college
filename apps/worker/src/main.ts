import { loadConfig } from "@glim/shared/config";
import { createLogger } from "@glim/telemetry";

const config = loadConfig();
createLogger({ service: "worker", level: config.logLevel }).info(
  { nodeEnv: config.nodeEnv },
  "worker starting",
);
