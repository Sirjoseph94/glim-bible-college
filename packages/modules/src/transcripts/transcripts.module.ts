import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { ContentModule } from "@glim/modules/content";
import { NotificationsModule } from "@glim/modules/notifications";
import { isUuid } from "@glim/shared";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { TranscriptsService } from "./transcripts.service";

/** Transcripts tell authorization whose programme enrollment or transcript it is (§7.2). */
@Injectable()
class TranscriptResources implements OnModuleInit {
  constructor(
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(TranscriptsService) private readonly transcripts: TranscriptsService,
  ) {}

  onModuleInit(): void {
    this.authorization.registerLoader("programme-enrollment", async (id) =>
      isUuid(id) ? this.transcripts.ownerOfEnrollment(id) : null,
    );
    this.authorization.registerLoader("transcript", async (id) =>
      isUuid(id) ? this.transcripts.ownerOfTranscript(id) : null,
    );
  }
}

/** Transcripts (TRD §14.7): requests, issue, and public verification. */
@Module({
  imports: [AuditModule, AuthorizationModule, ContentModule, NotificationsModule],
  providers: [TranscriptsService, TranscriptResources],
  exports: [TranscriptsService],
})
export class TranscriptsModule {}
