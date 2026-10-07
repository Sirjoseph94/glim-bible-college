import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as argon2 from "argon2";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

// OWASP Password Storage Cheat Sheet: argon2id, 19 MiB, 2 iterations, parallelism 1.
const ARGON2 = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

let breached: Set<string> | undefined;

/**
 * Passwords of 12+ characters from the 1M most common leaked passwords (SecLists, MIT licence),
 * lower-cased. Shorter ones are already refused by the length rule.
 */
function breachedPasswords(): Set<string> {
  breached ??= new Set(
    gunzipSync(readFileSync(new URL("./data/breached-passwords-12plus.txt.gz", import.meta.url)))
      .toString("utf8")
      .split("\n")
      .filter((line) => line.length > 0),
  );
  return breached;
}

export type PasswordProblem = "TOO_SHORT" | "TOO_LONG" | "BREACHED";

/** The password policy (§8.1): length 12–256 and not a known breached password. */
export function passwordProblem(password: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "TOO_SHORT";
  if (password.length > MAX_PASSWORD_LENGTH) return "TOO_LONG";
  if (breachedPasswords().has(password.toLowerCase())) return "BREACHED";
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Spends the same time as a real check, so an unknown email can't be told apart (§8.1). */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(await dummyHash, password);
}
