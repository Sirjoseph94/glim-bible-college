// Usage: pnpm --filter @glim/api admin:bootstrap --email admin@example.org --name "Full Name"
import "reflect-metadata";
import { parseArgs } from "node:util";
import { createBoss, createPool, Db } from "@glim/db";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { StaffAccountsService } from "@glim/modules/identity";
import { systemClock } from "@glim/shared";
import { loadConfig } from "@glim/shared/config";
import { createLogger } from "@glim/telemetry";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app";
import { createMailer } from "@glim/integrations/mail/factory";
import { createIdentityProvider } from "@glim/integrations/oidc/factory";
import { createObjectStorage } from "@glim/integrations/storage/factory";
import { createVideoHost } from "@glim/integrations/video-host/factory";
import { ReactPdfTranscriptRenderer } from "@glim/integrations/pdf/react-pdf";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
if (values.email === undefined || values.name === undefined) {
  console.error('Usage: admin:bootstrap --email <address> --name "<full name>"');
  process.exit(2);
}

const config = loadConfig();
const logger = createLogger({ service: "bootstrap", level: config.logLevel });
const boss = createBoss(config.db.url, { max: 1 });
boss.on("error", (error) => {
  logger.error({ err: error }, "pg-boss error");
});
await boss.start();
const db = new Db(createPool(config.db.url, 2), boss);
const app = await NestFactory.createApplicationContext(
  AppModule.forRoot({
    config,
    db,
    boss,
    clock: systemClock,
    logger,
    mailer: createMailer(config),
    identityProvider: createIdentityProvider(config),
    objectStorage: createObjectStorage(config),
    videoHost: createVideoHost(config),
    transcriptRenderer: new ReactPdfTranscriptRenderer(),
  }),
  { logger: false },
);

try {
  const result = await app
    .get(StaffAccountsService)
    .bootstrapSystemAdmin({ email: values.email, displayName: values.name }, SYSTEM_ACTOR);
  if (!result.ok) throw new Error(result.error.message);
  const invited = result.value;
  if (invited.emailSent) {
    console.log(`Invite emailed to ${invited.user.email}. The link is valid for 7 days.`);
  } else {
    console.log(
      `The invite email could not be sent. Give ${invited.user.email} this link (valid 7 days):`,
    );
    console.log(invited.inviteLink);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
  await boss.stop({ graceful: false });
  await db.pool.end();
}
