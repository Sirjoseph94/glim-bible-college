import { ENUMS, type EnumKey } from "@glim/contracts";
import { sql, type SQL } from "drizzle-orm";
import { check, customType, integer, timestamp, uuid, type PgColumn } from "drizzle-orm/pg-core";

/** Case-insensitive text (extension `citext`). */
export const citext = customType<{ data: string }>({ dataType: () => "citext" });

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const inet = customType<{ data: string }>({ dataType: () => "inet" });

/** `@std` (TRD §6.1): UUIDv7 id, created/updated timestamps and an optimistic-lock version. */
export const std = () => ({
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer().notNull().default(1),
});

/** `@std_ro`: append-only or immutable rows. */
export const stdRo = () => ({
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** `text + CHECK` for an enumeration mirrored in contracts/enums.ts. */
export function enumCheck(key: EnumKey, column: PgColumn): ReturnType<typeof check> {
  const [table, col] = key.split(".") as [string, string];
  const values = ENUMS[key].map((v: string) => `'${v}'`).join(", ");
  return check(`${table}_${col}_check`, sql`${column} IN (${sql.raw(values)})`);
}

export function checkSql(name: string, condition: SQL): ReturnType<typeof check> {
  return check(name, condition);
}
