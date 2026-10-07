import { v7 } from "uuid";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A new UUIDv7 for when an id is needed before insert (e.g. in a job payload).
 * Columns otherwise default to PostgreSQL's `uuidv7()` (TRD §5.1).
 */
export function newId(): string {
  return v7();
}

/** True for a canonical lower-case UUID of any version. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
