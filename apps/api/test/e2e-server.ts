// The stack Playwright drives (ticket 03): the real API and SPA on a fresh database, with an
// in-memory mailer whose messages are readable on a separate, test-only port.
import "reflect-metadata";
import { fileURLToPath } from "node:url";
import { createBoss, createPool, Db } from "@glim/db";
import { createTestDatabase, prepareTemplate } from "@glim/db/testing";
import { MemoryMailer } from "@glim/integrations/mail/memory";
import { FakeOidcIssuer, type FakeGoogleUser } from "@glim/integrations/oidc/fake-issuer";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
import { createObjectStorage } from "@glim/integrations/storage/factory";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { StaffAccountsService } from "@glim/modules/identity";
import { systemClock } from "@glim/shared";
import { loadConfig } from "@glim/shared/config";
import { createLogger } from "@glim/telemetry";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import Fastify from "fastify";
import { buildApp } from "../src/app";
import { bootstrapSystemAdmin } from "./bootstrap";

export const E2E_ADMIN = { email: "e2e-admin@glim.test", displayName: "Esther Admin" };

const config = loadConfig();
const logger = createLogger({ service: "e2e", level: "warn" });

let adminUrl = config.testing.postgresUrl;
const container =
  adminUrl === undefined ? await new PostgreSqlContainer("postgres:18").start() : null;
adminUrl ??= container?.getConnectionUri() ?? "";
await prepareTemplate(adminUrl);
const database = await createTestDatabase(adminUrl);

const boss = createBoss(database.appUrl, { max: 2 });
await boss.start();
const db = new Db(createPool(database.appUrl, 4), boss);
const mailer = new MemoryMailer();
// Stands in for accounts.google.com; specs queue who signs in next through the mailbox port.
const google = await new FakeOidcIssuer().start();
const app = await buildApp({
  config,
  db,
  boss,
  clock: systemClock,
  logger,
  mailer,
  identityProvider: new OpenIdConnectProvider({
    issuer: google.issuerUrl,
    clientId: google.clientId,
    clientSecret: google.clientSecret,
    allowHttp: true,
  }),
  objectStorage: createObjectStorage(config),
  staticDir: fileURLToPath(new URL("../../web/dist", import.meta.url)),
});
await bootstrapSystemAdmin(app, E2E_ADMIN);
// More invited staff, so each spec starts from its own account and none depends on another.
for (const staff of [
  { email: "e2e-ops@glim.test", displayName: "Obi Ops", roles: ["SYSTEM_ADMIN" as const] },
  { email: "e2e-google@glim.test", displayName: "Gloria Google", roles: ["REGISTRAR" as const] },
  {
    email: "e2e-settings@glim.test",
    displayName: "Sade Settings",
    roles: ["SYSTEM_ADMIN" as const],
  },
  {
    email: "e2e-academic@glim.test",
    displayName: "Ade Academic",
    roles: ["ACADEMIC_ADMIN" as const],
  },
]) {
  await app.get(StaffAccountsService).inviteStaff(staff, SYSTEM_ACTOR);
}
await app.listen(config.port, "127.0.0.1");

const mailbox = Fastify();
mailbox.get<{ Querystring: { to: string } }>("/last", (req, reply) => {
  const message = mailer.lastTo(req.query.to);
  return message ? message : reply.status(404).send({});
});
mailbox.post<{ Body: FakeGoogleUser }>("/google/next", (req, reply) => {
  google.nextSignIn(req.body);
  return reply.status(204).send();
});
await mailbox.listen({ port: config.port + 1, host: "127.0.0.1" });
logger.warn({ port: config.port }, "e2e stack ready");

async function shutdown(): Promise<void> {
  await mailbox.close();
  await app.close();
  await boss.stop({ graceful: false });
  await db.pool.end();
  await database.drop();
  await container?.stop();
  await google.stop();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
