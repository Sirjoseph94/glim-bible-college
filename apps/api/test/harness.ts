import { ReactPdfTranscriptRenderer } from "@glim/integrations/pdf/react-pdf";
import "reflect-metadata";
import { createBoss, createPool, Db } from "@glim/db";
import { createTestDatabase, type TestDatabase } from "@glim/db/testing";
import { MemoryMailer } from "@glim/integrations/mail/memory";
import { DisabledIdentityProvider } from "@glim/integrations/oidc/openid";
import type { LiveProvider } from "@glim/integrations/live-provider/port";
import type { IdentityProvider } from "@glim/integrations/oidc/port";
import { S3ObjectStorage } from "@glim/integrations/storage/s3";
import { FakeVideoHost } from "@glim/integrations/video-host/fake";
import { TestClock } from "@glim/shared";
import { loadConfig } from "@glim/shared/config";
import { createLogger } from "@glim/telemetry";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { PgBoss } from "pg-boss";
import { inject } from "vitest";
import { buildApp } from "../src/app";

export interface TestApp {
  app: NestFastifyApplication;
  db: Db;
  boss: PgBoss;
  /** Errors pg-boss reported (its connections dropping), heard as `main.ts` hears them. */
  bossErrors: Error[];
  clock: TestClock;
  /** Scriptable YouTube (TRD §21.3). */
  videoHost: FakeVideoHost;
  mailer: MemoryMailer;
  /** Every log line the app wrote, when created with `captureLogs`. */
  logs: string[];
  request(options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
    /** Defaults to a fresh address per request, so rate limits only bite tests that pin one. */
    remoteAddress?: string;
  }): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

let addressCounter = 0;
function nextAddress(): string {
  addressCounter++;
  return `10.${String((addressCounter >> 16) & 255)}.${String((addressCounter >> 8) & 255)}.${String(addressCounter & 255)}`;
}

/** Boots the real API against a fresh Postgres 18 database (spec: Seam 1). */
export async function createTestApp(
  options: {
    staticDir?: string;
    identityProvider?: IdentityProvider;
    captureLogs?: boolean;
    /** SendGrid's Event Webhook public key (base64 DER), for the webhook tests. */
    sendgridWebhookPublicKey?: string;
    /** Google Meet on (integration slice); off, meetings use pasted links as in v1. */
    liveProvider?: LiveProvider;
    phoneDialIn?: boolean;
    /** Lets the app hold a YouTube channel grant (integration slice). */
    tokenEncryptionKey?: Buffer;
    driveCleanupMode?: "NONE" | "TRASH_AFTER_INGEST";
  } = {},
): Promise<TestApp> {
  const database: TestDatabase = await createTestDatabase(inject("glim").postgresAdminUrl);
  const s3 = inject("glim").s3;
  const base = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  // Presigned URLs point at the test bucket's server, as they point at Spaces in production.
  const config = {
    ...base,
    storage: { ...base.storage, endpoint: s3.endpoint },
    mail: { ...base.mail, sendgridWebhookPublicKey: options.sendgridWebhookPublicKey },
    features: { ...base.features, phoneDialIn: options.phoneDialIn ?? false },
    tokenEncryptionKey: options.tokenEncryptionKey,
    driveCleanupMode: options.driveCleanupMode ?? base.driveCleanupMode,
  };
  const storage = new S3ObjectStorage({
    endpoint: s3.endpoint,
    region: config.storage.region,
    accessKeyId: s3.accessKey,
    secretAccessKey: s3.secretKey,
  });
  await storage.ensureBucket(config.storage.bucket);
  const boss = createBoss(database.appUrl, { max: 2 });
  const bossErrors: Error[] = [];
  boss.on("error", (error) => bossErrors.push(error));
  await boss.start();
  const db = new Db(createPool(database.appUrl, 4), boss);
  const clock = new TestClock("2026-11-02T09:00:00Z");
  const mailer = new MemoryMailer();
  const logs: string[] = [];
  const logger = options.captureLogs
    ? createLogger({ service: "api-test", level: "trace" }, { write: (line) => logs.push(line) })
    : createLogger({ service: "api-test", level: "silent" });
  const videoHost = new FakeVideoHost();
  const app = await buildApp({
    config,
    db,
    boss,
    clock,
    mailer,
    identityProvider: options.identityProvider ?? new DisabledIdentityProvider(),
    objectStorage: storage,
    videoHost,
    transcriptRenderer: new ReactPdfTranscriptRenderer(),
    liveProvider: options.liveProvider ?? null,
    logger,
    ...(options.staticDir === undefined ? {} : { staticDir: options.staticDir }),
  });
  const fastify: FastifyInstance = app.getHttpAdapter().getInstance();
  return {
    app,
    db,
    boss,
    bossErrors,
    clock,
    videoHost,
    mailer,
    logs,
    request: ({ method = "GET", url, headers, payload, remoteAddress }) =>
      fastify.inject({
        method,
        url,
        remoteAddress: remoteAddress ?? nextAddress(),
        // A browser on our own origin sends this on every write; tests override it to probe CSRF.
        headers: { ...(method === "GET" ? {} : { "sec-fetch-site": "same-origin" }), ...headers },
        ...(payload === undefined ? {} : { payload: payload as object }),
      }),
    close: async () => {
      await app.close();
      await boss.stop({ graceful: false });
      await db.pool.end();
      await database.drop();
    },
  };
}
