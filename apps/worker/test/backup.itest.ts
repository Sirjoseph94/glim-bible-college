import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createBoss, createPool, Db, migrateDatabase } from "@glim/db";
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
let adminUrl: string;
let pgDumpPath: string;

beforeAll(async () => {
  const { postgresAdminUrl, s3 } = inject("glim");
  adminUrl = postgresAdminUrl;
  pgDumpPath = loadConfig().backup.pgDumpPath;
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
      pgDumpPath,
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

  it("restores into an empty database as the runbook says, and the app can use it", async () => {
    // Something to find after the restore, and an audit row the app must still not change.
    await db.pool.query(
      "INSERT INTO users (email, display_name, status) VALUES ('restored@glim.test', 'Ruth Restored', 'ACTIVE')",
    );
    await db.pool.query(
      "INSERT INTO audit_logs (actor_type, action, resource_type, outcome) VALUES ('SYSTEM', 'drill.check', 'drill', 'SUCCESS')",
    );
    await db.withTx(({ boss: queue }) => queue.send("db.logical-backup", {}));
    expect(await drainQueues(boss, createHandlers({ context, subscribers: {} }))).toEqual({
      completed: 1,
      failed: 0,
    });
    const encrypted = await storage.download({
      bucket: "glim-backups",
      key: "postgres/glim-2026-11-08T01-00-00-000Z.dump.age",
    });
    const decrypter = new Decrypter();
    decrypter.addIdentity(identity);
    const dir = mkdtempSync(join(tmpdir(), "glim-restore-"));
    const file = join(dir, "glim.dump");
    writeFileSync(file, await decrypter.decrypt(encrypted ?? new Uint8Array()));

    // Runbook B: an empty database owned by the migrator, pg_restore as the migrator, migrate.
    const target = `glim_r_${database.name.slice(-12)}`;
    const admin = createPool(adminUrl, 1);
    await admin.query(`CREATE DATABASE ${target} OWNER glim_migrator`);
    const urlAs = (from: string) => {
      const url = new URL(from);
      url.pathname = `/${target}`;
      return url.toString();
    };
    const migratorUrl = urlAs(database.migratorUrl);
    const app = createPool(urlAs(database.appUrl), 1);
    try {
      const restore = spawnSync(
        join(dirname(pgDumpPath), "pg_restore"),
        [
          "--no-owner",
          "--clean",
          "--if-exists",
          "--role=glim_migrator",
          `--dbname=${migratorUrl}`,
          file,
        ],
        { encoding: "utf8" },
      );
      expect(restore.stderr).toBe("");
      expect(restore.status).toBe(0);
      await migrateDatabase({ migratorUrl });

      const found = await app.query<{ display_name: string }>(
        "SELECT display_name FROM users WHERE email = 'restored@glim.test'",
      );
      expect(found.rows).toEqual([{ display_name: "Ruth Restored" }]);
      // The app can write again, the queue works, and the audit log is still append-only.
      await app.query("UPDATE users SET updated_at = now() WHERE email = 'restored@glim.test'");
      await app.query(
        "INSERT INTO pgboss.job (name, data) SELECT name, '{}' FROM pgboss.queue LIMIT 1",
      );
      await expect(app.query("UPDATE audit_logs SET action = 'changed'")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await app.end();
      await admin.query(`DROP DATABASE IF EXISTS ${target} WITH (FORCE)`);
      await admin.end();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
