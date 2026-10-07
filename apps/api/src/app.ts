import "reflect-metadata";
import type { IncomingMessage } from "node:http";
import fastifyCompress from "@fastify/compress";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { Db } from "@glim/db";
import { IdentityModule } from "@glim/modules/identity";
import { newId, type Clock } from "@glim/shared";
import type { Config } from "@glim/shared/config";
import type { Logger } from "@glim/telemetry";
import { Global, Module, type DynamicModule, type LoggerService } from "@nestjs/common";
import { APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { PgBoss } from "pg-boss";
import { createErrorRenderer, ErrorFilter } from "./common/error.filter";
import { ResponseInterceptor } from "./common/response.interceptor";
import { helmetOptions } from "./common/security";
import { BOSS, CLOCK, CONFIG, LOGGER } from "./common/tokens";
import { HealthController } from "./http/platform/health.controller";
import { InstitutionController } from "./http/platform/institution.controller";
import { OpenApiController } from "./http/platform/openapi.controller";
import { DEFAULT_STATIC_DIR, hasStaticDir, setStaticHeaders, spaFallback } from "./static";

export interface AppDeps {
  config: Config;
  db: Db;
  boss: PgBoss;
  clock: Clock;
  logger: Logger;
  /** The built SPA; defaults to the directory the Docker image copies it into. */
  staticDir?: string;
}

@Global()
@Module({})
class CoreModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const providers = [
      { provide: CONFIG, useValue: deps.config },
      { provide: Db, useValue: deps.db },
      { provide: BOSS, useValue: deps.boss },
      { provide: CLOCK, useValue: deps.clock },
      { provide: LOGGER, useValue: deps.logger },
    ];
    return { module: CoreModule, providers, exports: providers.map((p) => p.provide) };
  }
}

@Module({})
class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot(deps), IdentityModule],
      controllers: [InstitutionController, OpenApiController, HealthController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: ResponseInterceptor }],
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
    trustProxy: true,
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

  fastify.addHook("onRequest", (req, reply, done) => {
    void reply.header("x-request-id", req.id);
    done();
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

  await app.register(fastifyHelmet, helmetOptions(deps.config));
  await app.register(fastifyCompress, { encodings: ["br", "gzip"], threshold: 1024 });
  // In-memory per instance (§5.7): the effective limit is limit × instances.
  await app.register(fastifyRateLimit, { global: true, max: 600, timeWindow: "1 minute" });
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
