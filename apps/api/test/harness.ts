import "reflect-metadata";
import { createBoss, createPool, Db } from "@glim/db";
import { createTestDatabase, type TestDatabase } from "@glim/db/testing";
import { MemoryMailer } from "@glim/integrations/mail/memory";
import { TestClock } from "@glim/shared";
import { loadConfig } from "@glim/shared/config";
import { createLogger } from "@glim/telemetry";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { inject } from "vitest";
import { buildApp } from "../src/app";

export interface TestApp {
  app: NestFastifyApplication;
  db: Db;
  clock: TestClock;
  mailer: MemoryMailer;
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
export async function createTestApp(options: { staticDir?: string } = {}): Promise<TestApp> {
  const database: TestDatabase = await createTestDatabase(inject("glim").postgresAdminUrl);
  const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const boss = createBoss(database.appUrl, { max: 2 });
  await boss.start();
  const db = new Db(createPool(database.appUrl, 4), boss);
  const clock = new TestClock("2026-11-02T09:00:00Z");
  const mailer = new MemoryMailer();
  const app = await buildApp({
    config,
    db,
    boss,
    clock,
    mailer,
    logger: createLogger({ service: "api-test", level: "silent" }),
    ...(options.staticDir === undefined ? {} : { staticDir: options.staticDir }),
  });
  const fastify: FastifyInstance = app.getHttpAdapter().getInstance();
  return {
    app,
    db,
    clock,
    mailer,
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
