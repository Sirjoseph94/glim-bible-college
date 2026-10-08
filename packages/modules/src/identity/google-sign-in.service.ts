import { Db, schema, type Database } from "@glim/db";
import {
  IDENTITY_PROVIDER,
  OidcError,
  type IdentityProvider,
  type OidcProfile,
} from "@glim/integrations/oidc/port";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { RoleService } from "@glim/modules/authorization";
import { CLOCK, MINUTE_MS, type Clock } from "@glim/shared";
import { CONFIG, type Config } from "@glim/shared/config";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { SignedIn } from "./auth.service";
import { SessionService, type ClientMeta } from "./session.service";
import { SettingsService } from "./settings.service";
import { signValue, verifySignedValue } from "./tokens";

/**
 * Why a Google sign-in started (§8.1): to sign in, to link Google to the signed-in account, or to
 * apply, which is the only way an unknown Google account gets a user (C-36).
 */
export type GoogleIntent = "signin" | "link" | "apply";

/** Where each intent lands by default, and where its failures are shown. */
const DEFAULT_RETURN: Record<GoogleIntent, string> = {
  signin: "/",
  link: "/profile",
  apply: "/application/edit",
};
const FAILURE_PAGE: Record<GoogleIntent, string> = {
  signin: "/login",
  link: "/profile",
  apply: "/apply",
};

/** Shown to the user after the redirect back; never more specific than they need. */
export type GoogleFailure =
  | "GOOGLE_UNAVAILABLE"
  | "GOOGLE_SIGN_IN_FAILED"
  | "GOOGLE_EMAIL_UNVERIFIED"
  | "ACCOUNT_NOT_FOUND"
  | "GOOGLE_DOMAIN_NOT_ALLOWED"
  | "GOOGLE_ALREADY_LINKED";

export type GoogleOutcome =
  | { kind: "signed-in"; signedIn: SignedIn; returnTo: string }
  | { kind: "linked"; returnTo: string }
  | { kind: "failed"; intent: GoogleIntent; failure: GoogleFailure; returnTo: string };

/** Kept in a signed cookie between the redirect to Google and the callback. */
interface FlowState {
  intent: GoogleIntent;
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  userId: string | null;
  expiresAt: number;
}

export const GOOGLE_FLOW_COOKIE = "__Host-glim_oidc";
export const GOOGLE_FLOW_LIFETIME_MS = 10 * MINUTE_MS;

/** Only same-site paths, so a crafted link can't bounce a user to another site after sign-in. */
export function safeReturnTo(value: string | undefined, fallback: string): string {
  if (
    value === undefined ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return fallback;
  return value;
}

/** Sign-in with Google and linking a Google account (§8.1). */
@Injectable()
export class GoogleSignInService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(IDENTITY_PROVIDER) private readonly provider: IdentityProvider,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  get enabled(): boolean {
    return this.provider.enabled;
  }

  get redirectUri(): string {
    return `${this.config.appOrigin}/api/v1/auth/google/callback`;
  }

  /** Starts the flow: where to send the browser, and the signed cookie to set first. */
  async begin(
    intent: GoogleIntent,
    options: { userId: string | null; returnTo?: string | undefined },
  ): Promise<{ redirectUrl: string; flowCookie: string } | { failure: GoogleFailure }> {
    if (!this.provider.enabled) return { failure: "GOOGLE_UNAVAILABLE" };
    try {
      const request = await this.provider.beginAuthorization(this.redirectUri);
      const flow: FlowState = {
        intent,
        state: request.state,
        nonce: request.nonce,
        codeVerifier: request.codeVerifier,
        returnTo: safeReturnTo(options.returnTo, DEFAULT_RETURN[intent]),
        userId: options.userId,
        expiresAt: this.clock.now().getTime() + GOOGLE_FLOW_LIFETIME_MS,
      };
      return {
        redirectUrl: request.url,
        flowCookie: signValue(flow, this.config.auth.sessionSecret),
      };
    } catch (error) {
      this.logger.warn({ err: error }, "google sign-in could not start");
      return { failure: "GOOGLE_UNAVAILABLE" };
    }
  }

  /**
   * Finishes the flow from Google's redirect. `currentUserId` is the signed-in user, if any; a link
   * only completes for the same user who started it.
   */
  async complete(
    callbackUrl: URL,
    flowCookie: string | undefined,
    context: ClientMeta & {
      currentUserId: string | null;
      previousSessionId: string | null;
      actor: AuditActor;
    },
  ): Promise<GoogleOutcome> {
    const flow = this.readFlow(flowCookie);
    if (flow === null)
      return {
        kind: "failed",
        intent: "signin",
        failure: "GOOGLE_SIGN_IN_FAILED",
        returnTo: "/login",
      };
    const fail = (failure: GoogleFailure): GoogleOutcome => ({
      kind: "failed",
      intent: flow.intent,
      failure,
      returnTo: flow.intent === "link" ? flow.returnTo : FAILURE_PAGE[flow.intent],
    });

    let profile: OidcProfile;
    try {
      profile = await this.provider.completeAuthorization(callbackUrl, flow);
    } catch (error) {
      this.logger.warn(
        { err: error instanceof OidcError ? error.message : error },
        "google sign-in failed",
      );
      return fail("GOOGLE_SIGN_IN_FAILED");
    }
    if (!profile.emailVerified) return fail("GOOGLE_EMAIL_UNVERIFIED");

    if (flow.intent === "link") {
      if (flow.userId === null || flow.userId !== context.currentUserId)
        return fail("GOOGLE_SIGN_IN_FAILED");
      const linked = await this.link(flow.userId, profile, context.actor);
      return linked ? { kind: "linked", returnTo: flow.returnTo } : fail("GOOGLE_ALREADY_LINKED");
    }

    const result = await this.signIn(profile, flow.intent, context);
    return "failure" in result
      ? fail(result.failure)
      : { kind: "signed-in", signedIn: result, returnTo: flow.returnTo };
  }

  /** Whether a user has linked a Google account. */
  async isLinked(userId: string): Promise<boolean> {
    const i = schema.identities;
    const [row] = await this.db.read
      .select({ id: i.id })
      .from(i)
      .where(and(eq(i.userId, userId), eq(i.provider, "google")));
    return row !== undefined;
  }

  private readFlow(cookie: string | undefined): FlowState | null {
    if (cookie === undefined) return null;
    const flow = verifySignedValue(cookie, this.config.auth.sessionSecret) as FlowState | null;
    if (flow === null || flow.expiresAt < this.clock.now().getTime()) return null;
    return flow;
  }

  /**
   * Matches by Google id, then by verified email (linking the identity on first use). Invited
   * staff become active: Google has verified they own the address the invite went to. Only the
   * apply intent creates a user for an unknown Google account: active, with no roles (§8.1).
   */
  private async signIn(
    profile: OidcProfile,
    intent: "signin" | "apply",
    context: ClientMeta & { previousSessionId: string | null; actor: AuditActor },
  ): Promise<SignedIn | { failure: GoogleFailure }> {
    const u = schema.users;
    const i = schema.identities;
    const [byIdentity] = await this.db.read
      .select({ user: u })
      .from(i)
      .innerJoin(u, eq(u.id, i.userId))
      .where(and(eq(i.provider, "google"), eq(i.subject, profile.subject)));
    const [byEmail] = byIdentity
      ? []
      : await this.db.read.select().from(u).where(eq(u.email, profile.email));
    const known = byIdentity?.user ?? byEmail;
    if (known === undefined && intent === "apply") return this.signUpApplicant(profile, context);
    const user = known;
    if (user === undefined || (user.status !== "ACTIVE" && user.status !== "INVITED")) {
      return { failure: "ACCOUNT_NOT_FOUND" };
    }

    const isStaff = (await this.roles.activeRoles(user.id)).length > 0;
    if (isStaff) {
      const domains = await this.settings.getStaffEmailDomains();
      const hd = profile.hostedDomain?.toLowerCase() ?? null;
      if (domains.length > 0 && (hd === null || !domains.includes(hd)))
        return { failure: "GOOGLE_DOMAIN_NOT_ALLOWED" };
    }

    return this.db.withTx(async ({ db }) => {
      const now = this.clock.now();
      if (byIdentity === undefined) {
        const actor = { ...context.actor, userId: user.id };
        if (!(await this.insertIdentity(db, user.id, profile, actor)))
          throw new Error("Google identity changed mid sign-in");
      }
      await db
        .update(u)
        .set({
          lastLoginAt: now,
          ...(user.status === "INVITED" ? { status: "ACTIVE", updatedAt: now } : {}),
        })
        .where(eq(u.id, user.id));
      if (context.previousSessionId !== null)
        await this.sessions.revoke(db, context.previousSessionId);
      return this.sessions.create(db, user.id, {
        ...context,
        applicant: intent === "apply" && !isStaff,
      });
    });
  }

  /** Self-registration from /apply (C-36): a role-less user who becomes an Applicant on starting. */
  private signUpApplicant(
    profile: OidcProfile,
    context: ClientMeta & { previousSessionId: string | null; actor: AuditActor },
  ): Promise<SignedIn> {
    return this.db.withTx(async ({ db }) => {
      const now = this.clock.now();
      const [user] = await db
        .insert(schema.users)
        .values({
          email: profile.email,
          displayName: profile.name?.trim() || profile.email.split("@")[0] || profile.email,
          status: "ACTIVE",
          lastLoginAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: schema.users.id });
      if (user === undefined) throw new Error("user insert returned nothing");
      const actor = { ...context.actor, userId: user.id };
      await this.audit.record(db, actor, {
        action: "identity.user.self-registered",
        resourceType: "user",
        resourceId: user.id,
        metadata: { via: "apply" },
      });
      if (!(await this.insertIdentity(db, user.id, profile, actor)))
        throw new Error("Google identity changed mid sign-up");
      if (context.previousSessionId !== null)
        await this.sessions.revoke(db, context.previousSessionId);
      return this.sessions.create(db, user.id, { ...context, applicant: true });
    });
  }

  /** Links Google to the user; false if that Google account or this user already has a different link. */
  private async link(userId: string, profile: OidcProfile, actor: AuditActor): Promise<boolean> {
    const i = schema.identities;
    const [existing] = await this.db.read
      .select({ userId: i.userId, subject: i.subject })
      .from(i)
      .where(and(eq(i.provider, "google"), eq(i.subject, profile.subject)));
    if (existing !== undefined) return existing.userId === userId;
    if (await this.isLinked(userId)) return false;
    return this.db.withTx(({ db }) => this.insertIdentity(db, userId, profile, actor));
  }

  private async insertIdentity(
    db: Database,
    userId: string,
    profile: OidcProfile,
    actor: AuditActor,
  ): Promise<boolean> {
    const now = this.clock.now();
    const [row] = await db
      .insert(schema.identities)
      .values({
        userId,
        provider: "google",
        subject: profile.subject,
        email: profile.email,
        metadata: { googleName: profile.name, hostedDomain: profile.hostedDomain },
        verifiedAt: now,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: schema.identities.id });
    if (row === undefined) return false;
    await this.audit.record(db, actor, {
      action: "identity.google.linked",
      resourceType: "user",
      resourceId: userId,
      metadata: { googleEmail: profile.email },
    });
    return true;
  }
}
