import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PgBoss } from "pg-boss";
import pg from "pg";
import { BOSS_SCHEMA, ensureQueues } from "./boss";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

export interface MigrateOptions {
  /** Connection string for glim_migrator, the schema owner (TRD §5.2). */
  migratorUrl: string;
  /** The DML-only role used by the api and worker. */
  appRole?: string;
  migrationsFolder?: string;
}

/**
 * Runs the Drizzle migrations, then the pg-boss schema migrations, creates the v1 queues, and
 * grants the app role DML on the pg-boss schema. This is what the PRE_DEPLOY `migrate` job runs.
 */
export async function migrateDatabase(options: MigrateOptions): Promise<void> {
  const appRole = options.appRole ?? "glim_app";
  const pool = new pg.Pool({ connectionString: options.migratorUrl, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: options.migrationsFolder ?? MIGRATIONS_FOLDER,
    });

    const boss = new PgBoss({
      connectionString: options.migratorUrl,
      schema: BOSS_SCHEMA,
      migrate: true,
      createSchema: true,
      supervise: false,
      schedule: false,
      max: 1,
    });
    await boss.start();
    try {
      await ensureQueues(boss);
    } finally {
      await boss.stop({ graceful: false });
    }

    const role = pg.escapeIdentifier(appRole);
    await pool.query(`
      GRANT USAGE ON SCHEMA ${BOSS_SCHEMA} TO ${role};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${BOSS_SCHEMA} TO ${role};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${BOSS_SCHEMA} TO ${role};
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${BOSS_SCHEMA} TO ${role};
      ALTER DEFAULT PRIVILEGES IN SCHEMA ${BOSS_SCHEMA} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};
      ALTER DEFAULT PRIVILEGES IN SCHEMA ${BOSS_SCHEMA} GRANT USAGE, SELECT ON SEQUENCES TO ${role};
      ALTER DEFAULT PRIVILEGES IN SCHEMA ${BOSS_SCHEMA} GRANT EXECUTE ON FUNCTIONS TO ${role};
    `);
  } finally {
    await pool.end();
  }
}
