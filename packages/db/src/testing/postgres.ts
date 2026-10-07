import { randomBytes } from "node:crypto";
import pg from "pg";
import { migrateDatabase } from "../migrate";

export const TEMPLATE_DB = "glim_template";
const TEST_DB_PREFIX = "glim_t_";
const ROLE_PASSWORD = "glim_test";

export interface TestDatabase {
  name: string;
  /** glim_app: DML only, as the api and worker connect. */
  appUrl: string;
  /** glim_migrator: the schema owner. */
  migratorUrl: string;
  drop(): Promise<void>;
}

export function urlFor(adminUrl: string, user: string, database: string): string {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = ROLE_PASSWORD;
  url.pathname = `/${database}`;
  return url.toString();
}

async function withAdmin<T>(adminUrl: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Creates the roles, rebuilds the migrated template database, and removes test databases left by
 * earlier runs. Runs once per test run (vitest global setup).
 */
export async function prepareTemplate(adminUrl: string): Promise<void> {
  await withAdmin(adminUrl, async (admin) => {
    for (const role of ["glim_migrator", "glim_app"]) {
      const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      const verb = exists.rowCount === 0 ? "CREATE" : "ALTER";
      await admin.query(`${verb} ROLE ${role} LOGIN PASSWORD '${ROLE_PASSWORD}'`);
    }
    const stale = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname = $1 OR datname LIKE $2",
      [TEMPLATE_DB, `${TEST_DB_PREFIX}%`],
    );
    for (const { datname } of stale.rows) {
      await admin.query(`DROP DATABASE ${pg.escapeIdentifier(datname)} WITH (FORCE)`);
    }
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB} OWNER glim_migrator`);
  });
  await migrateDatabase({ migratorUrl: urlFor(adminUrl, "glim_migrator", TEMPLATE_DB) });
}

/** A fresh, fully migrated database cloned from the template. */
export async function createTestDatabase(adminUrl: string): Promise<TestDatabase> {
  const name = `${TEST_DB_PREFIX}${randomBytes(6).toString("hex")}`;
  await withAdmin(adminUrl, (admin) =>
    admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB} OWNER glim_migrator`),
  );
  return {
    name,
    appUrl: urlFor(adminUrl, "glim_app", name),
    migratorUrl: urlFor(adminUrl, "glim_migrator", name),
    drop: () =>
      withAdmin(adminUrl, async (admin) => {
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      }),
  };
}
