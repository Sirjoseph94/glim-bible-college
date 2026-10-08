import { video, type BodyOf, type ParamsOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { PlaybackService, VideosService } from "@glim/modules/video";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** Course videos (TRD §13). */
@Controller()
export class VideosController {
  constructor(
    @Inject(VideosService) private readonly videos: VideosService,
    @Inject(PlaybackService) private readonly playback: PlaybackService,
  ) {}

  @Endpoint(video.listVideos)
  async list(
    @Params(video.listVideos) params: ParamsOf<typeof video.listVideos>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof video.listVideos>> {
    return { items: await this.videos.list(params.id, session.userId) };
  }

  @Endpoint(video.getVideo)
  async get(
    @Params(video.getVideo) params: ParamsOf<typeof video.getVideo>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof video.getVideo>> {
    const found = await this.videos.get(params.id, session.userId);
    if (found === null) throw new AppError("NOT_FOUND", "Not found.");
    return found;
  }

  @Endpoint(video.addVideo)
  async add(
    @Params(video.addVideo) params: ParamsOf<typeof video.addVideo>,
    @Body(video.addVideo) body: BodyOf<typeof video.addVideo>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof video.addVideo>> {
    return unwrap(await this.videos.add(params.id, body, { ...actor, userId: session.userId }));
  }

  @Endpoint(video.updateVideo)
  async update(
    @Params(video.updateVideo) params: ParamsOf<typeof video.updateVideo>,
    @Body(video.updateVideo) body: BodyOf<typeof video.updateVideo>,
    @IfMatch() version: number,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof video.updateVideo>> {
    return unwrap(
      await this.videos.update(params.id, version, body, { ...actor, userId: session.userId }),
    );
  }

  @Endpoint(video.publishVideo)
  async publish(
    @Params(video.publishVideo) params: ParamsOf<typeof video.publishVideo>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof video.publishVideo>> {
    return unwrap(await this.videos.publish(params.id, { ...actor, userId: session.userId }));
  }

  @Endpoint(video.unpublishVideo)
  async unpublish(
    @Params(video.unpublishVideo) params: ParamsOf<typeof video.unpublishVideo>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof video.unpublishVideo>> {
    return unwrap(await this.videos.unpublish(params.id, { ...actor, userId: session.userId }));
  }

  @Endpoint(video.reorderVideos)
  async reorder(
    @Params(video.reorderVideos) params: ParamsOf<typeof video.reorderVideos>,
    @Body(video.reorderVideos) body: BodyOf<typeof video.reorderVideos>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof video.reorderVideos>> {
    return {
      items: unwrap(
        await this.videos.reorder(params.id, body.videoIds, { ...actor, userId: session.userId }),
      ),
    };
  }

  /** Never cached: the answer depends on who asks and changes as they watch (§13.4). */
  @Endpoint(video.playVideo)
  async play(
    @Params(video.playVideo) params: ParamsOf<typeof video.playVideo>,
    @CurrentSession() session: ActiveSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Reply<typeof video.playVideo>> {
    void reply.header("cache-control", "no-store");
    return unwrap(await this.playback.play(params.id, session.userId));
  }

  @Endpoint(video.saveProgress)
  async progress(
    @Params(video.saveProgress) params: ParamsOf<typeof video.saveProgress>,
    @Body(video.saveProgress) body: BodyOf<typeof video.saveProgress>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof video.saveProgress>> {
    return unwrap(await this.playback.saveProgress(params.id, session.userId, body));
  }
}
