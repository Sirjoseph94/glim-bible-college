import { createBoss, createPool, Db } from "@glim/db";
import { createTestDatabase, drainQueues, type TestDatabase } from "@glim/db/testing";
import { S3ObjectStorage } from "@glim/integrations/storage/s3";
import { TestClock } from "@glim/shared";
import { loadConfig } from "@glim/shared/config";
import { createLogger } from "@glim/telemetry";
import type { INestApplicationContext } from "@nestjs/common";
import { Decrypter, generateIdentity, identityToRecipient } from "age-encryption";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createHandlers } from "../src/handlers";
import { createWorkerContext } from "../src/worker.module";

let database: TestDatabase;
let db: Db;
let boss: ReturnType<typeof createBoss>;
let context: INestApplicationContext;
let storage: S3ObjectStorage;
let identity: string;

beforeAll(async () => {
  const { postgresAdminUrl, s3 } = inject("glim");
  database = await createTestDatabase(postgresAdminUrl);
  boss = createBoss(database.appUrl, { max: 2 });
  await boss.start();
  db = new Db(createPool(database.appUrl, 2), boss);
  identity = await generateIdentity();
  storage = new S3ObjectStorage({
    endpoint: s3.endpoint,
    region: "us-east-1",
    accessKeyId: s3.accessKey,
    secretAccessKey: s3.secretKey,
  });
  await storage.ensureBucket("glim-backups");

  const base = loadConfig({ NODE_ENV: "test" });
  const config = {
    ...base,
    db: { ...base.db, directUrl: database.appUrl },
    backup: {
      ageRecipient: await identityToRecipient(identity),
      pgDumpPath: loadConfig().backup.pgDumpPath,
    },
    storage: { ...base.storage, backupBucket: "glim-backups" },
  };
  context = await createWorkerContext({
    db,
    clock: new TestClock("2026-11-08T01:00:00Z"),
    logger: createLogger({ service: "backup-test", level: "silent" }),
    config,
    objectStorage: storage,
  });
});

afterAll(async () => {
  await context.close();
  await boss.stop({ graceful: false });
  await db.pool.end();
  await database.drop();
  storage.destroy();
});

describe("db.logical-backup", () => {
  it("writes an age-encrypted pg_dump custom-format archive to the backups bucket", async () => {
    await db.withTx(({ boss: queue }) => queue.send("db.logical-backup", {}));
    const result = await drainQueues(boss, createHandlers({ context, subscribers: {} }));
    expect(result).toEqual({ completed: 1, failed: 0 });

    const keys = await storage.list({ bucket: "glim-backups", prefix: "postgres/" });
    expect(keys).toContain("postgres/glim-2026-11-08T01-00-00-000Z.dump.age");

    const encrypted = await storage.download({
      bucket: "glim-backups",
      key: "postgres/glim-2026-11-08T01-00-00-000Z.dump.age",
    });
    expect(encrypted).not.toBeNull();
    // Without the key it's ciphertext...
    expect(
      Buffer.from(encrypted ?? [])
        .subarray(0, 21)
        .toString(),
    ).toBe("age-encryption.org/v1");
    // ...and with it, a pg_dump custom-format archive.
    const decrypter = new Decrypter();
    decrypter.addIdentity(identity);
    const plain = await decrypter.decrypt(encrypted ?? new Uint8Array());
    expect(Buffer.from(plain).subarray(0, 5).toString()).toBe("PGDMP");
  });
});
