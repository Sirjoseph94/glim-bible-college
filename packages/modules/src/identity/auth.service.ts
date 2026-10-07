import { Db, schema, type Database } from "@glim/db";
import { AppError, CLOCK, type Clock } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { AccountMailer } from "./account-mailer";
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword } from "./passwords";
import { SessionService, type ActiveSession } from "./session.service";
import { generateToken, hashToken } from "./tokens";

const MINUTE = 60_000;

/** Lockout and token lifetimes (§8.1). */
export const AUTH_POLICY = {
  maxFailedLogins: 5,
  lockoutMs: 15 * MINUTE,
  inviteMs: 7 * 24 * 60 * MINUTE,
  resetMs: 30 * MINUTE,
} as const;

export interface ClientMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface SignedIn {
  token: string;
  session: ActiveSession;
}

type TokenPurpose = "INVITE" | "PASSWORD_RESET";

const INVALID_CREDENTIALS = () =>
  new AppError("INVALID_CREDENTIALS", "The email or password is incorrect.");
const INVALID_LINK = () =>
  new AppError("VALIDATION_FAILED", "This link is invalid or has expired.", {
    fieldErrors: [
      {
        path: "body.token",
        code: "token_invalid",
        message: "This link is invalid or has expired.",
      },
    ],
  });

/** Local email + password sign-in for staff and imported students (§8.1). */
@Injectable()
export class AuthService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AccountMailer) private readonly mail: AccountMailer,
  ) {}

  /**
   * Signs in with email and password. Unknown emails, wrong passwords and accounts that can't use
   * a password all fail the same way, in the same time (no account enumeration).
   */
  async login(
    input: { email: string; password: string; previousSessionId?: string | undefined } & ClientMeta,
  ): Promise<SignedIn> {
    const now = this.clock.now();
    const [user] = await this.db.read
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, input.email.trim()));

    if (user?.lockedUntil != null && user.lockedUntil > now) {
      const retryAfter = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000);
      throw new AppError("ACCOUNT_LOCKED", "Too many failed sign-in attempts. Try again later.", {
        headers: { "retry-after": String(retryAfter) },
      });
    }
    if (user?.status !== "ACTIVE" || user.passwordHash === null) {
      await verifyAgainstDummy(input.password);
      throw INVALID_CREDENTIALS();
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.recordFailure(user.id, now);
      throw INVALID_CREDENTIALS();
    }

    return this.db.withTx(async ({ db }) => {
      await db
        .update(schema.users)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now })
        .where(eq(schema.users.id, user.id));
      // Always rotate: a session presented at sign-in is replaced, never reused (§8.3).
      if (input.previousSessionId !== undefined)
        await this.sessions.revoke(db, input.previousSessionId);
      return this.sessions.create(db, user.id, input);
    });
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.withTx(({ db }) => this.sessions.revoke(db, sessionId));
  }

  /** Issues a 7-day invite token inside the caller's transaction; earlier open invites stop working. */
  async issueInvite(db: Database, userId: string, createdBy: string | null): Promise<string> {
    return this.issueToken(db, userId, "INVITE", AUTH_POLICY.inviteMs, createdBy);
  }

  /** Accepting an invite sets the password, activates the account and signs the user in. */
  async acceptInvite(input: { token: string; password: string } & ClientMeta): Promise<SignedIn> {
    const problem = passwordFieldError(input.password);
    if (problem) throw problem;
    const passwordHash = await hashPassword(input.password);

    return this.db.withTx(async ({ db }) => {
      const now = this.clock.now();
      const token = await this.consumeToken(db, input.token, "INVITE", now);
      const [user] = await db
        .update(schema.users)
        .set({
          passwordHash,
          passwordChangedAt: now,
          status: "ACTIVE",
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: now,
          updatedAt: now,
          version: sql`${schema.users.version} + 1`,
        })
        .where(and(eq(schema.users.id, token.userId), eq(schema.users.status, "INVITED")))
        .returning({ id: schema.users.id });
      if (user === undefined) throw INVALID_LINK();
      await this.sessions.revokeAllForUser(db, user.id);
      return this.sessions.create(db, user.id, input);
    });
  }

  /**
   * Starts a password reset. Always succeeds from the caller's point of view; only active users
   * who already have a password get an email (§8.1).
   */
  async requestPasswordReset(email: string): Promise<void> {
    const issued = await this.db.withTx(async ({ db }) => {
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email.trim()));
      if (user?.status !== "ACTIVE" || user.passwordHash === null) return null;
      const token = await this.issueToken(db, user.id, "PASSWORD_RESET", AUTH_POLICY.resetMs, null);
      return { user, token };
    });
    if (issued) await this.mail.sendPasswordReset(issued.user, issued.token);
  }

  /** Sets a new password from a reset link; every session of the user is revoked. */
  async resetPassword(input: { token: string; password: string }): Promise<void> {
    const problem = passwordFieldError(input.password);
    if (problem) throw problem;
    const passwordHash = await hashPassword(input.password);

    await this.db.withTx(async ({ db }) => {
      const now = this.clock.now();
      const token = await this.consumeToken(db, input.token, "PASSWORD_RESET", now);
      const [user] = await db
        .update(schema.users)
        .set({
          passwordHash,
          passwordChangedAt: now,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: now,
          version: sql`${schema.users.version} + 1`,
        })
        .where(and(eq(schema.users.id, token.userId), eq(schema.users.status, "ACTIVE")))
        .returning({ id: schema.users.id });
      if (user === undefined) throw INVALID_LINK();
      await this.sessions.revokeAllForUser(db, user.id);
    });
  }

  private async recordFailure(userId: string, now: Date): Promise<void> {
    const limit = AUTH_POLICY.maxFailedLogins;
    const lockUntil = new Date(now.getTime() + AUTH_POLICY.lockoutMs);
    await this.db.read
      .update(schema.users)
      .set({
        failedLoginCount: sql`CASE WHEN ${schema.users.failedLoginCount} + 1 >= ${limit} THEN 0 ELSE ${schema.users.failedLoginCount} + 1 END`,
        lockedUntil: sql`CASE WHEN ${schema.users.failedLoginCount} + 1 >= ${limit} THEN ${lockUntil.toISOString()}::timestamptz ELSE ${schema.users.lockedUntil} END`,
      })
      .where(eq(schema.users.id, userId));
  }

  private async issueToken(
    db: Database,
    userId: string,
    purpose: TokenPurpose,
    lifetimeMs: number,
    createdBy: string | null,
  ): Promise<string> {
    const now = this.clock.now();
    await db
      .update(schema.authTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.authTokens.userId, userId),
          eq(schema.authTokens.purpose, purpose),
          isNull(schema.authTokens.usedAt),
        ),
      );
    const token = generateToken();
    await db.insert(schema.authTokens).values({
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + lifetimeMs),
      createdBy,
      createdAt: now,
    });
    return token;
  }

  /** Marks a token used, atomically; a used, expired or unknown token is rejected. */
  private async consumeToken(db: Database, token: string, purpose: TokenPurpose, now: Date) {
    const [row] = await db
      .update(schema.authTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.authTokens.tokenHash, hashToken(token)),
          eq(schema.authTokens.purpose, purpose),
          isNull(schema.authTokens.usedAt),
          gt(schema.authTokens.expiresAt, now),
        ),
      )
      .returning({ userId: schema.authTokens.userId });
    if (row === undefined) throw INVALID_LINK();
    return row;
  }
}

function passwordFieldError(password: string): AppError | null {
  const problem = passwordProblem(password);
  if (problem === null) return null;
  const message = {
    TOO_SHORT: "Use at least 12 characters.",
    TOO_LONG: "Use at most 256 characters.",
    BREACHED: "This password has appeared in data breaches. Choose a different one.",
  }[problem];
  return new AppError("VALIDATION_FAILED", message, {
    fieldErrors: [{ path: "body.password", code: `password_${problem.toLowerCase()}`, message }],
  });
}
