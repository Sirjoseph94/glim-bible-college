import { SESSION_COOKIE, type SignedIn } from "@glim/modules/identity";
import type { FastifyReply } from "fastify";

/** `__Host-` cookie: HttpOnly, Secure, SameSite=Lax, Path=/ and no Domain (§8.3). */
export function setSessionCookie(reply: FastifyReply, signedIn: SignedIn): void {
  // A new session's lastSeenAt is its start, so this is the absolute lifetime.
  const { expiresAt, lastSeenAt } = signedIn.session;
  const maxAge = Math.round((expiresAt.getTime() - lastSeenAt.getTime()) / 1000);
  void reply.setCookie(SESSION_COOKIE, signedIn.token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(maxAge, 0),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
}
