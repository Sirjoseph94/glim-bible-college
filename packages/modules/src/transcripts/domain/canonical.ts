import { createHash, randomBytes } from "node:crypto";

/**
 * Canonical JSON (TRD §14.7): object keys sorted at every level, no whitespace, arrays in order.
 * The same snapshot always gives the same text, so its SHA-256 can anchor a transcript.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new TypeError("canonical JSON has no NaN or Infinity");
    if (value === undefined) throw new TypeError("canonical JSON has no undefined");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** The SHA-256 of the canonical JSON, as lower-case hex. */
export function snapshotSha256(snapshot: unknown): string {
  return createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 16 characters of RFC 4648 base32 from 80 random bits: the public verification code. */
export function verificationCode(bytes: Uint8Array = randomBytes(10)): string {
  if (bytes.length !== 10) throw new RangeError("a verification code takes 10 bytes");
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  return out;
}
