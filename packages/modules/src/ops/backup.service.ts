import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { OBJECT_STORAGE, type ObjectStorage } from "@glim/integrations/storage/port";
import { CLOCK, type Clock } from "@glim/shared";
import { CONFIG, type Config } from "@glim/shared/config";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { Encrypter } from "age-encryption";

/** The schemas a logical dump holds: the app's data, the job queue, and the migration journal. */
const SCHEMAS = ["public", "pgboss", "drizzle"];
/**
 * The extensions the schemas use. `--schema` leaves extensions out of a dump, so without these
 * a restore into an empty database fails on every citext column (found in the ticket 46 drill).
 */
const EXTENSIONS = ["citext", "btree_gist"];

/**
 * pg_dump's environment for a connection string. The password travels in the environment, never
 * on the command line. A verifying `sslmode` without `sslrootcert` checks the server against the
 * system's CA store (`system`, libpq 16+), as node-postgres does with Node's; libpq would
 * otherwise look for ~/.postgresql/root.crt and fail (Neon's certificate is public, ADR-0004).
 */
export function pgDumpEnv(connectionString: string): Record<string, string> {
  const db = new URL(connectionString);
  const sslmode = db.searchParams.get("sslmode") ?? "prefer";
  const rootCert =
    db.searchParams.get("sslrootcert") ?? (sslmode.startsWith("verify-") ? "system" : null);
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    PGHOST: db.hostname,
    PGPORT: db.port || "5432",
    PGUSER: decodeURIComponent(db.username),
    PGPASSWORD: decodeURIComponent(db.password),
    PGDATABASE: db.pathname.replace(/^\//, ""),
    PGSSLMODE: sslmode,
    ...(rootCert === null ? {} : { PGSSLROOTCERT: rootCert }),
  };
}

/**
 * The weekly logical backup (`db.logical-backup`, TRD §22.7): `pg_dump -Fc` over the direct
 * connection, encrypted with age to BACKUP_AGE_RECIPIENT, streamed to the backups bucket. The
 * age private key is held offline; the bucket's lifecycle rule expires dumps after 12 weeks.
 */
@Injectable()
export class BackupService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** Returns the object key of the encrypted dump. */
  async run(): Promise<string> {
    const recipient = this.config.backup.ageRecipient;
    if (recipient === undefined)
      throw new Error("BACKUP_AGE_RECIPIENT is not set; refusing to write an unencrypted backup");

    const stamp = this.clock.now().toISOString().replaceAll(/[:.]/g, "-");
    const key = `postgres/glim-${stamp}.dump.age`;
    const bucket = this.config.storage.backupBucket;

    const dump = spawn(
      this.config.backup.pgDumpPath,
      // Privileges are kept: the public grants (and the audit log's revoked UPDATE/DELETE) are
      // made by migrations, which don't run again on a restored database.
      [
        "--format=custom",
        "--no-owner",
        ...SCHEMAS.map((s) => `--schema=${s}`),
        ...EXTENSIONS.map((e) => `--extension=${e}`),
      ],
      {
        env: pgDumpEnv(this.config.db.directUrl),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    dump.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    const exited = new Promise<number>((resolve, reject) => {
      dump.on("error", reject);
      dump.on("close", (code) => {
        resolve(code ?? -1);
      });
    });

    const encrypter = new Encrypter();
    encrypter.addRecipient(recipient);
    const encrypted = await encrypter.encrypt(
      Readable.toWeb(dump.stdout) as ReadableStream<Uint8Array>,
    );
    const uploaded = this.storage.upload({
      bucket,
      key,
      body: Readable.fromWeb(encrypted),
      contentType: "application/octet-stream",
    });

    const [code] = await Promise.all([exited, uploaded]);
    if (code !== 0) {
      await this.storage.remove({ bucket, key }).catch(() => undefined);
      throw new Error(`pg_dump exited with ${String(code)}: ${stderr.trim()}`);
    }
    this.logger.info({ bucket, key }, "logical backup written");
    return key;
  }
}
