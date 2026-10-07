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
