import "reflect-metadata";
import type { Db } from "@glim/db";
import { createMailer } from "@glim/integrations/mail/factory";
import { createIdentityProvider } from "@glim/integrations/oidc/factory";
import type { Mailer } from "@glim/integrations/mail/port";
import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule } from "@glim/modules/authorization";
import { IdentityModule } from "@glim/modules/identity";
import { PlatformModule, type PlatformDeps } from "@glim/modules/platform";
import type { Clock } from "@glim/shared";
import { loadConfig, type Config } from "@glim/shared/config";
import type { Logger } from "@glim/telemetry";
import { Module, type DynamicModule, type INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

@Module({})
class WorkerModule {
  static forRoot(deps: PlatformDeps): DynamicModule {
    return {
      module: WorkerModule,
      imports: [PlatformModule.forRoot(deps), AuditModule, AuthorizationModule, IdentityModule],
    };
  }
}

/** The application services job handlers call: the same modules the API uses (§4.3.4). */
export function createWorkerContext(deps: {
  db: Db;
  clock: Clock;
  logger: Logger;
  config?: Config;
  mailer?: Mailer;
}): Promise<INestApplicationContext> {
  const config = deps.config ?? loadConfig({ NODE_ENV: "test" });
  return NestFactory.createApplicationContext(
    WorkerModule.forRoot({
      ...deps,
      config,
      mailer: deps.mailer ?? createMailer(config),
      identityProvider: createIdentityProvider(config),
    }),
    { logger: false },
  );
}
