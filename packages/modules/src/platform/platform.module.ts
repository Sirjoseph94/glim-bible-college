import { Db } from "@glim/db";
import { MAILER, type Mailer } from "@glim/integrations/mail/port";
import { IDENTITY_PROVIDER, type IdentityProvider } from "@glim/integrations/oidc/port";
import { OBJECT_STORAGE, type ObjectStorage } from "@glim/integrations/storage/port";
import { CLOCK, type Clock } from "@glim/shared";
import { CONFIG, type Config } from "@glim/shared/config";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Global, Module, type DynamicModule } from "@nestjs/common";

/** Infrastructure the composition roots (api, worker, CLIs) bind for every module. */
export interface PlatformDeps {
  config: Config;
  db: Db;
  clock: Clock;
  logger: Logger;
  mailer: Mailer;
  /** Google sign-in (OIDC); a disabled provider when no client is configured. */
  identityProvider: IdentityProvider;
  /** DO Spaces / MinIO. */
  objectStorage: ObjectStorage;
}

@Global()
@Module({})
export class PlatformModule {
  static forRoot(deps: PlatformDeps): DynamicModule {
    const providers = [
      { provide: CONFIG, useValue: deps.config },
      { provide: Db, useValue: deps.db },
      { provide: CLOCK, useValue: deps.clock },
      { provide: LOGGER, useValue: deps.logger },
      { provide: MAILER, useValue: deps.mailer },
      { provide: IDENTITY_PROVIDER, useValue: deps.identityProvider },
      { provide: OBJECT_STORAGE, useValue: deps.objectStorage },
    ];
    return { module: PlatformModule, providers, exports: providers.map((p) => p.provide) };
  }
}
