import "reflect-metadata";
import type { Db } from "@glim/db";
import { createMailer } from "@glim/integrations/mail/factory";
import { createIdentityProvider } from "@glim/integrations/oidc/factory";
import { createObjectStorage } from "@glim/integrations/storage/factory";
import { createLiveProvider } from "@glim/integrations/live-provider/factory";
import type { LiveProvider } from "@glim/integrations/live-provider/port";
import { createVideoHost } from "@glim/integrations/video-host/factory";
import { ReactPdfTranscriptRenderer } from "@glim/integrations/pdf/react-pdf";
import type { VideoHost } from "@glim/integrations/video-host/port";
import type { ObjectStorage } from "@glim/integrations/storage/port";
import type { Mailer } from "@glim/integrations/mail/port";
import { AdmissionsModule } from "@glim/modules/admissions";
import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule } from "@glim/modules/authorization";
import { IdentityModule } from "@glim/modules/identity";
import { AttendanceModule } from "@glim/modules/attendance";
import { ClassMeetingModule } from "@glim/modules/class-meeting";
import { VideoModule } from "@glim/modules/video";
import { AssessmentModule } from "@glim/modules/assessment";
import { ResultsModule } from "@glim/modules/results";
import { TranscriptsModule } from "@glim/modules/transcripts";
import { ImportsModule } from "@glim/modules/imports";
import { OpsModule } from "@glim/modules/ops";
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
      imports: [
        PlatformModule.forRoot(deps),
        AuditModule,
        AuthorizationModule,
        IdentityModule,
        OpsModule,
        AdmissionsModule,
        ImportsModule,
        ClassMeetingModule,
        AttendanceModule,
        VideoModule,
        AssessmentModule,
        ResultsModule,
        TranscriptsModule,
      ],
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
  objectStorage?: ObjectStorage;
  videoHost?: VideoHost;
  liveProvider?: LiveProvider | null;
}): Promise<INestApplicationContext> {
  const config = deps.config ?? loadConfig({ NODE_ENV: "test" });
  return NestFactory.createApplicationContext(
    WorkerModule.forRoot({
      ...deps,
      config,
      mailer: deps.mailer ?? createMailer(config),
      identityProvider: createIdentityProvider(config),
      objectStorage: deps.objectStorage ?? createObjectStorage(config),
      videoHost: deps.videoHost ?? createVideoHost(),
      liveProvider:
        deps.liveProvider === undefined ? createLiveProvider(config) : deps.liveProvider,
      transcriptRenderer: new ReactPdfTranscriptRenderer(),
    }),
    { logger: false },
  );
}
