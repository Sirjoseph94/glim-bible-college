import type { EndpointSpec } from "@glim/contracts";
import { SESSION_COOKIE, SessionService, type ActiveSession } from "@glim/modules/identity";
import { AppError } from "@glim/shared";
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
    session: ActiveSession | null;
    /** The client's IP: the platform's client-IP header when configured, else the socket (§5.4). */
    clientIp: string;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const csrfInvalid = () =>
  new AppError("CSRF_INVALID", "The request was refused. Reload the page and try again.");

/**
 * Resolves the session cookie and enforces each endpoint's `auth` (§8.3): a session where
 * required, the CSRF header on writes, and same-origin checks on every write.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.get<EndpointSpec | undefined>(
      ENDPOINT_METADATA,
      context.getHandler(),
    );
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const unsafe = !SAFE_METHODS.has(req.method);
    if (unsafe) this.assertSameOrigin(req);

    const token = req.cookies[SESSION_COOKIE];
    req.session = token === undefined ? null : await this.sessions.resolve(token);

    if (spec?.auth === "session") {
      if (req.session === null) throw new AppError("UNAUTHENTICATED", "Please sign in.");
      const header = req.headers["x-csrf-token"];
      if (
        unsafe &&
        !this.sessions.verifyCsrf(req.session, typeof header === "string" ? header : undefined)
      ) {
        throw csrfInvalid();
      }
    }
    return true;
  }

  private assertSameOrigin(req: FastifyRequest): void {
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== this.config.appOrigin) throw csrfInvalid();
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none") throw csrfInvalid();
  }
}

/** The caller's session; use only on `auth: "session"` endpoints, where the guard guarantees one. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActiveSession => {
    const session = context.switchToHttp().getRequest<FastifyRequest>().session;
    if (session === null) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    return session;
  },
);
