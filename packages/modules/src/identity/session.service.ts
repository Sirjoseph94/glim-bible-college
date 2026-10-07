import { randomBytes } from "node:crypto";
import { Db, schema, type Database } from "@glim/db";
import { CLOCK, DAY_MS, HOUR_MS, MINUTE_MS, type Clock } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { csrfTokenFor, generateToken, hashToken, safeEqual } from "./tokens";

/** Session lifetimes (§8.3). */
export const SESSION_LIFETIME = {
  idleMs: 2 * HOUR_MS,
  /** Applicants fill in a long form saved as a draft, so they get a longer idle window. */
  applicantIdleMs: 24 * HOUR_MS,
  absoluteMs: 12 * HOUR_MS,
  /** The sliding idle expiry is written at most this often. */
  touchEveryMs: MINUTE_MS,
  /** In-process lookup cache: revocation takes effect within this window (§5.7). */
  cacheMs: 5_000,
  /** Ended sessions are kept this long for investigation, then deleted. */
  keepEndedMs: 7 * DAY_MS,
} as const;

export const SESSION_COOKIE = "__Host-glim_sid";

/** Where a request came from; recorded on sessions and audit rows. */
export interface ClientMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface ActiveSession {
  sessionId: string;
  userId: string;
  csrfToken: string;
  expiresAt: Date;
  idleExpiresAt: Date;
  lastSeenAt: Date;
  /** Sliding idle window for this session: 2 h, or 24 h for applicants. */
  idleWindowMs: number;
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
    meta: ClientMeta & { applicant?: boolean } = {},
  ): Promise<{ token: string; session: ActiveSession }> {
    const token = generateToken();
    const now = this.clock.now();
    const idleWindowMs = meta.applicant
      ? SESSION_LIFETIME.applicantIdleMs
      : SESSION_LIFETIME.idleMs;
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME.absoluteMs);
    const csrfSecret = randomBytes(32);
    const [row] = await db
      .insert(schema.authSessions)
      .values({
        userId,
        createdAt: now,
        tokenHash: hashToken(token),
        expiresAt,
        idleExpiresAt: idleExpiry(now, idleWindowMs, expiresAt),
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

  /** Revokes every session of a user, e.g. after a password change or deactivation (§8.1, §8.2). */
  async revokeAllForUser(db: Database, userId: string): Promise<void> {
    await db
      .update(schema.authSessions)
      .set({ revokedAt: this.clock.now() })
      .where(and(eq(schema.authSessions.userId, userId), isNull(schema.authSessions.revokedAt)));
    this.forget((entry) => entry.userId === userId);
  }

  /** Deletes sessions that ended more than a week ago (`auth.session-cleanup`, §17.2). */
  async deleteEnded(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - SESSION_LIFETIME.keepEndedMs);
    const t = schema.authSessions;
    const deleted = await this.db.withTx(({ db }) =>
      db
        .delete(t)
        .where(
          or(
            lt(t.expiresAt, cutoff),
            lt(t.idleExpiresAt, cutoff),
            and(isNotNull(t.revokedAt), lt(t.revokedAt, cutoff)),
          ),
        )
        .returning({ id: t.id }),
    );
    return deleted.length;
  }

  private async touch(session: ActiveSession, now: Date): Promise<ActiveSession> {
    const idleExpiresAt = idleExpiry(now, session.idleWindowMs, session.expiresAt);
    await this.db.withTx(({ db }) =>
      db
        .update(schema.authSessions)
        .set({ idleExpiresAt, lastSeenAt: now })
        .where(eq(schema.authSessions.id, session.sessionId)),
    );
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

function idleExpiry(now: Date, idleWindowMs: number, expiresAt: Date): Date {
  return new Date(Math.min(now.getTime() + idleWindowMs, expiresAt.getTime()));
}

/**
 * The idle window isn't stored (the TRD schema has no column for it). A session started with the
 * applicant window always has more than 2 h of idle time left after a touch, until the absolute
 * expiry makes the two windows equal anyway.
 */
function idleWindowOf(row: typeof schema.authSessions.$inferSelect): number {
  const remainingIdle = row.idleExpiresAt.getTime() - row.lastSeenAt.getTime();
  return remainingIdle > SESSION_LIFETIME.idleMs
    ? SESSION_LIFETIME.applicantIdleMs
    : SESSION_LIFETIME.idleMs;
}

function toActive(row: typeof schema.authSessions.$inferSelect, csrfSecret: Buffer): ActiveSession {
  return {
    sessionId: row.id,
    userId: row.userId,
    csrfToken: csrfTokenFor(row.id, csrfSecret),
    expiresAt: row.expiresAt,
    idleExpiresAt: row.idleExpiresAt,
    lastSeenAt: row.lastSeenAt,
    idleWindowMs: idleWindowOf(row),
  };
}

function isLive(session: ActiveSession, now: Date): boolean {
  return session.expiresAt > now && session.idleExpiresAt > now;
}
