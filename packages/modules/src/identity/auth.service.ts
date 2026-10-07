import { Db, schema, type Database } from "@glim/db";
import {
  CLOCK,
  DAY_MS,
  domainError,
  err,
  MINUTE_MS,
  ok,
  type Clock,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { AccountMailer } from "./account-mailer";
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword } from "./passwords";
import { SessionService, type ActiveSession, type ClientMeta } from "./session.service";
import { generateToken, hashToken } from "./tokens";

/** Lockout and token lifetimes (§8.1). */
export const AUTH_POLICY = {
  maxFailedLogins: 5,
  lockoutMs: 15 * MINUTE_MS,
  inviteMs: 7 * DAY_MS,
  resetMs: 30 * MINUTE_MS,
} as const;

export interface SignedIn {
  token: string;
  session: ActiveSession;
}

type TokenPurpose = "INVITE" | "PASSWORD_RESET";

/**
 * The one answer for every failed sign-in: unknown email, wrong password, an account that can't
 * use a password, or a locked account. Nothing tells them apart (§8.1).
 */
const INVALID_CREDENTIALS = domainError(
  "INVALID_CREDENTIALS",
  "The email or password is incorrect, or the account is locked after too many attempts. Try again later or reset your password.",
);

const INVALID_LINK = domainError("VALIDATION_FAILED", "This link is invalid or has expired.", {
  fieldErrors: [
    { path: "body.token", code: "token_invalid", message: "This link is invalid or has expired." },
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

  /** Signs in with email and password. Every failure looks and takes the same (§8.1). */
  async login(
    input: { email: string; password: string; previousSessionId?: string | undefined } & ClientMeta,
  ): Promise<DomainResult<SignedIn>> {
    const now = this.clock.now();
    const [user] = await this.db.read
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, input.email.trim()));

    const locked = user?.lockedUntil != null && user.lockedUntil > now;
    if (user?.status !== "ACTIVE" || user.passwordHash === null || locked) {
      await verifyAgainstDummy(input.password);
      return err(INVALID_CREDENTIALS);
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.recordFailure(user.id, now);
      return err(INVALID_CREDENTIALS);
    }

    return ok(
      await this.db.withTx(async ({ db }) => {
        await db
          .update(schema.users)
          .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now })
          .where(eq(schema.users.id, user.id));
        // Always rotate: a session presented at sign-in is replaced, never reused (§8.3).
        if (input.previousSessionId !== undefined)
          await this.sessions.revoke(db, input.previousSessionId);
        return this.sessions.create(db, user.id, input);
      }),
    );
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.withTx(({ db }) => this.sessions.revoke(db, sessionId));
  }

  /** Issues a 7-day invite token inside the caller's transaction; earlier open invites stop working. */
  issueInvite(db: Database, userId: string, createdBy: string | null): Promise<string> {
    return this.issueToken(db, userId, "INVITE", AUTH_POLICY.inviteMs, createdBy);
  }

  /** Accepting an invite sets the password, activates the account and signs the user in. */
  acceptInvite(
    input: { token: string; password: string } & ClientMeta,
  ): Promise<DomainResult<SignedIn>> {
    return this.setPasswordFromLink(input, "INVITE", async (db, userId) =>
      this.sessions.create(db, userId, input),
    );
  }

  /** Sets a new password from a reset link; every session of the user is revoked. */
  async resetPassword(input: { token: string; password: string }): Promise<DomainResult<null>> {
    return this.setPasswordFromLink(input, "PASSWORD_RESET", () => Promise.resolve(null));
  }

  /**
   * Starts a password reset. Always succeeds, in the same time, whether or not the email belongs to
   * an account: the email is sent after the response, and only to active users with a password.
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
    if (issued) void this.mail.sendPasswordReset(issued.user, issued.token);
  }

  /**
   * Shared by invite acceptance and password reset: check the policy, consume the link, set the
   * password (activating an invited account), revoke every session, then `afterwards`.
   */
  private async setPasswordFromLink<T>(
    input: { token: string; password: string },
    purpose: TokenPurpose,
    afterwards: (db: Database, userId: string) => Promise<T>,
  ): Promise<DomainResult<T>> {
    const problem = passwordProblemError(input.password);
    if (problem) return err(problem);
    const passwordHash = await hashPassword(input.password);
    const fromStatus = purpose === "INVITE" ? "INVITED" : "ACTIVE";

    return this.db.withTxResult(async ({ db }) => {
      const now = this.clock.now();
      const token = await this.consumeToken(db, input.token, purpose, now);
      if (token === null) return err(INVALID_LINK);
      const [user] = await db
        .update(schema.users)
        .set({
          passwordHash,
          passwordChangedAt: now,
          status: "ACTIVE",
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: now,
          version: sql`${schema.users.version} + 1`,
          ...(purpose === "INVITE" ? { lastLoginAt: now } : {}),
        })
        .where(and(eq(schema.users.id, token.userId), eq(schema.users.status, fromStatus)))
        .returning({ id: schema.users.id });
      if (user === undefined) return err(INVALID_LINK);
      await this.sessions.revokeAllForUser(db, user.id);
      return ok(await afterwards(db, user.id));
    });
  }

  private async recordFailure(userId: string, now: Date): Promise<void> {
    const limit = AUTH_POLICY.maxFailedLogins;
    const lockUntil = new Date(now.getTime() + AUTH_POLICY.lockoutMs);
    const count = schema.users.failedLoginCount;
    await this.db.withTx(({ db }) =>
      db
        .update(schema.users)
        .set({
          failedLoginCount: sql`CASE WHEN ${count} + 1 >= ${limit} THEN 0 ELSE ${count} + 1 END`,
          lockedUntil: sql`CASE WHEN ${count} + 1 >= ${limit} THEN ${lockUntil.toISOString()}::timestamptz ELSE ${schema.users.lockedUntil} END`,
        })
        .where(eq(schema.users.id, userId)),
    );
  }

  private async issueToken(
    db: Database,
    userId: string,
    purpose: TokenPurpose,
    lifetimeMs: number,
    createdBy: string | null,
  ): Promise<string> {
    const now = this.clock.now();
    const t = schema.authTokens;
    await db
      .update(t)
      .set({ usedAt: now })
      .where(and(eq(t.userId, userId), eq(t.purpose, purpose), isNull(t.usedAt)));
    const token = generateToken();
    await db.insert(t).values({
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + lifetimeMs),
      createdBy,
      createdAt: now,
    });
    return token;
  }

  /** Marks a token used, atomically; null for a used, expired or unknown token. */
  private async consumeToken(db: Database, token: string, purpose: TokenPurpose, now: Date) {
    const t = schema.authTokens;
    const [row] = await db
      .update(t)
      .set({ usedAt: now })
      .where(
        and(
          eq(t.tokenHash, hashToken(token)),
          eq(t.purpose, purpose),
          isNull(t.usedAt),
          gt(t.expiresAt, now),
        ),
      )
      .returning({ userId: t.userId });
    return row ?? null;
  }
}

function passwordProblemError(password: string) {
  const problem = passwordProblem(password);
  if (problem === null) return null;
  const message = {
    TOO_SHORT: "Use at least 12 characters.",
    TOO_LONG: "Use at most 256 characters.",
    BREACHED: "This password has appeared in data breaches. Choose a different one.",
  }[problem];
  return domainError("VALIDATION_FAILED", message, {
    fieldErrors: [{ path: "body.password", code: `password_${problem.toLowerCase()}`, message }],
  });
}
