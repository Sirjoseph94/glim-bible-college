/** DI tokens for infrastructure bound by the composition root. */
export { CLOCK } from "@glim/shared";
export { CONFIG } from "@glim/shared/config";
export { LOGGER } from "@glim/telemetry";
export { MAILER } from "@glim/integrations/mail/port";
export const BOSS = Symbol.for("glim.PgBoss");
