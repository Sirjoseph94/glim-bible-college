import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { IdentityModule } from "@glim/modules/identity";
import { isUuid } from "@glim/shared";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { PlaybackService } from "./playback.service";
import { VideosService } from "./videos.service";

/** Videos tell authorization which offering each belongs to (§7.2). */
@Injectable()
class VideoResources implements OnModuleInit {
  constructor(
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(VideosService) private readonly videos: VideosService,
  ) {}

  onModuleInit(): void {
    this.authorization.registerLoader("video", async (id) => {
      if (!isUuid(id)) return null;
      const offeringId = await this.videos.offeringOf(id);
      return offeringId === null ? null : { offeringId };
    });
  }
}

/** Course videos on YouTube (TRD §13, ADR-0003). */
@Module({
  imports: [AuditModule, AuthorizationModule, IdentityModule],
  providers: [VideosService, PlaybackService, VideoResources],
  exports: [VideosService, PlaybackService],
})
export class VideoModule {}
