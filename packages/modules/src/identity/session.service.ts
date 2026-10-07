import { randomBytes } from "node:crypto";
import { Db, schema, type Database } from "@glim/db";
import { CLOCK, type Clock } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { csrfTokenFor, generateToken, hashToken, safeEqual } from "./tokens";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Session lifetimes (§8.3). */
export const SESSION_LIFETIME = {
  idleMs: 2 * HOUR,
  absoluteMs: 12 * HOUR,
  /** Applicants fill in a long form saved as a draft, so their sessions last a day. */
  applicantIdleMs: 24 * HOUR,
  applicantAbsoluteMs: 24 * HOUR,
  /** The sliding idle expiry is written at most this often. */
  touchEveryMs: MINUTE,
  /** In-process lookup cache: revocation takes effect within this window (§5.7). */
  cacheMs: 5_000,
} as const;

export const SESSION_COOKIE = "__Host-glim_sid";

export interface ActiveSession {
  sessionId: string;
  userId: string;
  csrfToken: string;
  expiresAt: Date;
  idleExpiresAt: Date;
  lastSeenAt: Date;
  long: boolean;
}

interface CacheEntry {
  session: ActiveSession | null;
  userId: string | null;
  cachedUntil: number;
}

const CACHE_MAX = 10_000;

/** Opaque, revocable sessions stored as SHA-256(token) (§8.3). */
@Injectable()
export class SessionService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Starts a session for a user; the caller sets the returned token as the cookie. */
  async create(
    db: Database,
    userId: string,
    meta: { ip?: string | undefined; userAgent?: string | undefined; longIdle?: boolean } = {},
  ): Promise<{ token: string; session: ActiveSession }> {
    const token = generateToken();
    const now = this.clock.now();
    const long = meta.longIdle ?? false;
    const idleMs = long ? SESSION_LIFETIME.applicantIdleMs : SESSION_LIFETIME.idleMs;
    const absoluteMs = long ? SESSION_LIFETIME.applicantAbsoluteMs : SESSION_LIFETIME.absoluteMs;
    const csrfSecret = randomBytes(32);
    const [row] = await db
      .insert(schema.authSessions)
      .values({
        userId,
        createdAt: now,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + absoluteMs),
        idleExpiresAt: new Date(now.getTime() + idleMs),
        lastSeenAt: now,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
        csrfSecret,
      })
      .returning();
    if (row === undefined) throw new Error("Session insert returned no row");
    return { token, session: toActive(row, csrfSecret) };
  }

  /** The live session for a cookie token, or null if unknown, revoked, expired or the user isn't active. */
  async resolve(token: string): Promise<ActiveSession | null> {
    const key = hashToken(token);
    const cacheKey = key.toString("base64url");
    const now = this.clock.now();
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined && cached.cachedUntil > now.getTime()) {
      return cached.session !== null && isLive(cached.session, now) ? cached.session : null;
    }

    const [row] = await this.db.read
      .select({ session: schema.authSessions, userStatus: schema.users.status })
      .from(schema.authSessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.authSessions.userId))
      .where(eq(schema.authSessions.tokenHash, key));

    let session: ActiveSession | null = null;
    if (row !== undefined && row.session.revokedAt === null && row.userStatus === "ACTIVE") {
      session = toActive(row.session, row.session.csrfSecret);
      if (!isLive(session, now)) session = null;
    }
    if (
      session !== null &&
      now.getTime() - session.lastSeenAt.getTime() >= SESSION_LIFETIME.touchEveryMs
    ) {
      session = await this.touch(session, now);
    }
    this.remember(cacheKey, {
      session,
      userId: row?.session.userId ?? null,
      cachedUntil: now.getTime() + SESSION_LIFETIME.cacheMs,
    });
    return session;
  }

  verifyCsrf(session: ActiveSession, header: string | undefined): boolean {
    return header !== undefined && safeEqual(session.csrfToken, header);
  }

  async revoke(db: Database, sessionId: string): Promise<void> {
    await db
      .update(schema.authSessions)
      .set({ revokedAt: this.clock.now() })
      .where(and(eq(schema.authSessions.id, sessionId), isNull(schema.authSessions.revokedAt)));
    this.forget((entry) => entry.session?.sessionId === sessionId);
  }

  /** Revokes every session of a user, e.g. after a password change (§8.1, §8.3). */
  async revokeAllForUser(db: Database, userId: string): Promise<void> {
    await db
      .update(schema.authSessions)
      .set({ revokedAt: this.clock.now() })
      .where(and(eq(schema.authSessions.userId, userId), isNull(schema.authSessions.revokedAt)));
    this.forget((entry) => entry.userId === userId);
  }

  private async touch(session: ActiveSession, now: Date): Promise<ActiveSession> {
    const idleMs = session.long ? SESSION_LIFETIME.applicantIdleMs : SESSION_LIFETIME.idleMs;
    const idleExpiresAt = new Date(Math.min(now.getTime() + idleMs, session.expiresAt.getTime()));
    await this.db.read
      .update(schema.authSessions)
      .set({ idleExpiresAt, lastSeenAt: now })
      .where(eq(schema.authSessions.id, session.sessionId));
    return { ...session, idleExpiresAt, lastSeenAt: now };
  }

  private remember(key: string, entry: CacheEntry): void {
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next();
      if (oldest.done !== true) this.cache.delete(oldest.value);
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
  }

  private forget(match: (entry: CacheEntry) => boolean): void {
    for (const [key, entry] of this.cache) if (match(entry)) this.cache.delete(key);
  }
}

function toActive(row: typeof schema.authSessions.$inferSelect, csrfSecret: Buffer): ActiveSession {
  return {
    sessionId: row.id,
    userId: row.userId,
    csrfToken: csrfTokenFor(row.id, csrfSecret),
    expiresAt: row.expiresAt,
    idleExpiresAt: row.idleExpiresAt,
    lastSeenAt: row.lastSeenAt,
    long: row.expiresAt.getTime() - row.createdAt.getTime() > SESSION_LIFETIME.absoluteMs,
  };
}

function isLive(session: ActiveSession, now: Date): boolean {
  return session.expiresAt > now && session.idleExpiresAt > now;
}
