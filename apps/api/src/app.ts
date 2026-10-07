import "reflect-metadata";
import type { IncomingMessage } from "node:http";
import fastifyCompress from "@fastify/compress";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { AcademicModule } from "@glim/modules/academic";
import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule } from "@glim/modules/authorization";
import { IdentityModule, SESSION_COOKIE, SessionService } from "@glim/modules/identity";
import { PlatformModule, type PlatformDeps } from "@glim/modules/platform";
import { newId } from "@glim/shared";
import type { Logger } from "@glim/telemetry";
import { Module, type DynamicModule, type LoggerService } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { PgBoss } from "pg-boss";
import { AuthGuard } from "./common/auth.guard";
import { rateLimitKey } from "./common/endpoint";
import { createErrorRenderer, ErrorFilter } from "./common/error.filter";
import { ResponseInterceptor } from "./common/response.interceptor";
import { helmetOptions } from "./common/security";
import { BOSS } from "./common/tokens";
import { AuthController } from "./http/identity/auth.controller";
import { GoogleController } from "./http/identity/google.controller";
import { AcademicController } from "./http/academic/academic.controller";
import { AuditController } from "./http/audit/audit.controller";
import { MeController } from "./http/identity/me.controller";
import { SettingsController } from "./http/settings/settings.controller";
import { UsersController } from "./http/users/users.controller";
import { HealthController } from "./http/platform/health.controller";
import { InstitutionController } from "./http/platform/institution.controller";
import { OpenApiController } from "./http/platform/openapi.controller";
import { DEFAULT_STATIC_DIR, hasStaticDir, setStaticHeaders, spaFallback } from "./static";

export interface AppDeps extends PlatformDeps {
  boss: PgBoss;
  /** The built SPA; defaults to the directory the Docker image copies it into. */
  staticDir?: string;
}

@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot(deps),
        AuditModule,
        AuthorizationModule,
        IdentityModule,
        AcademicModule,
      ],
      controllers: [
        InstitutionController,
        OpenApiController,
        HealthController,
        AuthController,
        GoogleController,
        MeController,
        UsersController,
        AuditController,
        SettingsController,
        AcademicController,
      ],
      providers: [
        { provide: BOSS, useValue: deps.boss },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    };
  }
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

function nestLogger(logger: Logger): LoggerService {
  return {
    log: (message: unknown) => {
      logger.debug({ nest: true }, String(message));
    },
    warn: (message: unknown) => {
      logger.warn({ nest: true }, String(message));
    },
    error: (message: unknown, trace?: unknown) => {
      logger.error({ nest: true, trace }, String(message));
    },
  };
}

/** Builds the API: REST at /api/v1 and the SPA at /, on one origin (TRD §4.1). */
export async function buildApp(deps: AppDeps): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    // Never trust X-Forwarded-For (spoofable); the client IP comes from CLIENT_IP_HEADER below.
    trustProxy: false,
    bodyLimit: 1_048_576,
    requestIdHeader: false,
    genReqId: (req: IncomingMessage) => {
      const header = req.headers["x-request-id"];
      return typeof header === "string" && SAFE_REQUEST_ID.test(header) ? header : newId();
    },
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(deps), adapter, {
    logger: nestLogger(deps.logger),
  });
  const fastify = app.getHttpAdapter().getInstance();

  const staticDir = deps.staticDir ?? DEFAULT_STATIC_DIR;
  const serveSpa = hasStaticDir(staticDir);
  // Nest routes Fastify hook errors (e.g. rate limiting) through the global filter as well.
  app.useGlobalFilters(
    new ErrorFilter(createErrorRenderer(deps.logger, serveSpa ? spaFallback : null)),
  );

  const ipHeader = deps.config.clientIpHeader;
  const sessions = app.get(SessionService);
  fastify.decorateRequest("clientIp", "");
  fastify.decorateRequest("session", null);
  fastify.decorateRequest("principal", null);
  fastify.addHook("onRequest", (req, reply, done) => {
    const forwarded = ipHeader === undefined ? undefined : req.headers[ipHeader];
    req.clientIp = typeof forwarded === "string" && forwarded.length > 0 ? forwarded : req.ip;
    void reply.header("x-request-id", req.id);
    done();
  });
  // After cookies are parsed and before rate limiting, so per-user limits key on the real user.
  fastify.addHook("preValidation", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token !== undefined && req.url.startsWith("/api/"))
      req.session = await sessions.resolve(token);
  });
  fastify.addHook("onResponse", (req, reply, done) => {
    const path = req.routeOptions.url ?? "(unrouted)";
    if (path !== "/healthz" && path !== "/readyz") {
      deps.logger.info(
        {
          requestId: req.id,
          method: req.method,
          route: path,
          status: reply.statusCode,
          durationMs: Math.round(reply.elapsedTime),
        },
        "request",
      );
    }
    done();
  });

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, helmetOptions(deps.config));
  await app.register(fastifyCompress, { encodings: ["br", "gzip"], threshold: 1024 });
  // In-memory per instance (§5.7): the effective limit is limit × instances.
  await app.register(fastifyRateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    hook: "preHandler",
    keyGenerator: rateLimitKey,
  });
  if (serveSpa) {
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: "/",
      preCompressed: true,
      setHeaders: setStaticHeaders,
    });
  }

  await app.init();
  return app;
}
