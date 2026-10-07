import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** A 32-byte random token for cookies, invites and resets (§8.1, §8.3). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only SHA-256(token) is ever stored. */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/** The CSRF token for a session: HMAC(csrf_secret, sessionId) (§8.3). */
export function csrfTokenFor(sessionId: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(sessionId).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** `base64url(json).hmac` — a value only this server could have produced. */
export function signValue(payload: unknown, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** The payload of a value from `signValue`, or null if it was altered. */
export function verifySignedValue(value: string, secret: string): unknown {
  const [body, mac] = value.split(".");
  if (body === undefined || mac === undefined) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(mac, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
