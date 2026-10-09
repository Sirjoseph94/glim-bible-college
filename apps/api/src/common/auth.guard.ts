import type { EndpointSpec, Permission } from "@glim/contracts";
import { Db } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { AuthorizationService, type Principal } from "@glim/modules/authorization";
import { SessionService, type ActiveSession } from "@glim/modules/identity";
import { AppError, CLOCK, MINUTE_MS, type Clock } from "@glim/shared";
import { CONFIG, type Config } from "@glim/shared/config";
import {
  createParamDecorator,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ENDPOINT_METADATA } from "./endpoint";

declare module "fastify" {
  interface FastifyRequest {
    /** Resolved from the session cookie before rate limiting and routing. */
    session: ActiveSession | null;
    /** The client's IP: the platform's client-IP header when configured, else the socket (§5.4). */
    clientIp: string;
    /** The caller for authorization, memoized for this request only (§7.2). */
    principal: Principal | null;
    /** The exact JSON body, kept for provider webhooks whose signature covers it. */
    rawBody: string | null;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const csrfInvalid = () =>
  new AppError("CSRF_INVALID", "The request was refused. Reload the page and try again.");

/**
 * Enforces each endpoint's contract (§7, §8.3): writes must come from our own origin; `session`
 * endpoints need a live session and, for writes, the CSRF header; a `permission` is decided by the
 * AuthorizationService. A resource the caller can't see is a 404; a collection they can't use, 403.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  /** Denied writes are audited at most once a minute per (user, permission) (§7.2). */
  private readonly lastDeniedAudit = new Map<string, number>();

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.get<EndpointSpec | undefined>(
      ENDPOINT_METADATA,
      context.getHandler(),
    );
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const unsafe = !SAFE_METHODS.has(req.method);
    if (unsafe && spec?.signedWebhook !== true) this.assertSameOrigin(req);
    if (spec?.auth !== "session") return true;

    const session = req.session;
    if (session === null) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    const header = req.headers["x-csrf-token"];
    if (
      unsafe &&
      !this.sessions.verifyCsrf(session, typeof header === "string" ? header : undefined)
    ) {
      throw csrfInvalid();
    }
    if (spec.permission === undefined) return true;

    req.principal ??= this.authorization.principal(session.userId);
    const resourceId =
      spec.resource === undefined
        ? undefined
        : ((spec.resource.in === "query" ? req.query : req.params) as Record<string, unknown>)[
            spec.resource.param
          ];
    const decision = await this.authorization.authorize(
      req.principal,
      spec.permission,
      spec.resource === undefined || typeof resourceId !== "string"
        ? undefined
        : {
            type: spec.resource.type,
            id: resourceId,
            ...(spec.resource.ownPart === true ? { ownPart: true } : {}),
          },
    );
    if (decision === "ALLOW") return true;
    if (unsafe) await this.auditDenied(req, session, spec.permission);
    if (decision === "NOT_FOUND") throw new AppError("NOT_FOUND", "Not found.");
    throw new AppError("FORBIDDEN", "You don't have permission to do that.");
  }

  /**
   * Browsers always send Origin or Sec-Fetch-Site on writes; requiring one of them, and checking
   * it, stops cross-site form posts to the public endpoints that have no CSRF token yet.
   */
  private assertSameOrigin(req: FastifyRequest): void {
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    if (origin === undefined && site === undefined) throw csrfInvalid();
    if (origin !== undefined && origin !== this.config.appOrigin) throw csrfInvalid();
    if (site !== undefined && site !== "same-origin" && site !== "none") throw csrfInvalid();
  }

  private async auditDenied(
    req: FastifyRequest,
    session: ActiveSession,
    permission: Permission,
  ): Promise<void> {
    const key = `${session.userId}:${permission}`;
    const now = this.clock.now().getTime();
    const last = this.lastDeniedAudit.get(key);
    if (last !== undefined && now - last < MINUTE_MS) return;
    this.lastDeniedAudit.set(key, now);
    await this.db.withTx(({ db }) =>
      this.audit.record(db, actorOf(req), {
        action: "authorization.denied",
        resourceType: "endpoint",
        resourceId: `${req.method} ${req.routeOptions.url ?? req.url}`,
        outcome: "DENIED",
        metadata: { permission },
      }),
    );
  }
}

/** The audit actor for a request. */
export function actorOf(req: FastifyRequest): AuditActor {
  return {
    userId: req.session?.userId ?? null,
    type: "USER",
    requestId: req.id,
    ip: req.clientIp,
    userAgent: req.headers["user-agent"],
  };
}

/** The caller's session; use only on `auth: "session"` endpoints, where the guard guarantees one. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActiveSession => {
    const session = context.switchToHttp().getRequest<FastifyRequest>().session;
    if (session === null) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    return session;
  },
);

/** The audit actor for the current request. */
export const Actor = createParamDecorator((_data: unknown, context: ExecutionContext): AuditActor =>
  actorOf(context.switchToHttp().getRequest<FastifyRequest>()),
);
