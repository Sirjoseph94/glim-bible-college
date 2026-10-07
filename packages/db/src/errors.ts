/** SQLSTATE codes the app turns into domain errors (INV-4: Postgres enforces the rule). */
export const PG = {
  UNIQUE_VIOLATION: "23505",
  CHECK_VIOLATION: "23514",
  EXCLUSION_VIOLATION: "23P01",
  FOREIGN_KEY_VIOLATION: "23503",
} as const;

interface PgErrorFields {
  code: string;
  constraint?: string;
}

/** The PostgreSQL error inside a (possibly Drizzle-wrapped) error, if there is one. */
export function pgError(error: unknown): PgErrorFields | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      typeof current.code === "string" &&
      /^[0-9A-Z]{5}$/.test(current.code)
    ) {
      const constraint =
        "constraint" in current && typeof current.constraint === "string"
          ? current.constraint
          : undefined;
      return constraint === undefined ? { code: current.code } : { code: current.code, constraint };
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return null;
}
