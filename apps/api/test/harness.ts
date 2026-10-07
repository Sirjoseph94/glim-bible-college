import "reflect-metadata";
import { createBoss, createPool, Db } from "@glim/db";
import { createTestDatabase, type TestDatabase } from "@glim/db/testing";
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
  request(options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

/** Boots the real API against a fresh Postgres 18 database (spec: Seam 1). */
export async function createTestApp(options: { staticDir?: string } = {}): Promise<TestApp> {
  const database: TestDatabase = await createTestDatabase(inject("glim").postgresAdminUrl);
  const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const boss = createBoss(database.appUrl, { max: 2 });
  await boss.start();
  const db = new Db(createPool(database.appUrl, 4), boss);
  const clock = new TestClock("2026-11-02T09:00:00Z");
  const app = await buildApp({
    config,
    db,
    boss,
    clock,
    logger: createLogger({ service: "api-test", level: "silent" }),
    ...(options.staticDir === undefined ? {} : { staticDir: options.staticDir }),
  });
  const fastify: FastifyInstance = app.getHttpAdapter().getInstance();
  return {
    app,
    db,
    clock,
    request: ({ method = "GET", url, headers, payload }) =>
      fastify.inject({
        method,
        url,
        ...(headers ? { headers } : {}),
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
