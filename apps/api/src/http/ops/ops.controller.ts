import { ops, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import { GoogleIntegrationService } from "@glim/modules/class-meeting";
import type { ActiveSession } from "@glim/modules/identity";
import { IntegrationsService, OpsService } from "@glim/modules/ops";
import { unwrap } from "@glim/shared";
import { CONFIG, type Config } from "@glim/shared/config";
import { Controller, Inject, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params, Query } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** The consent round trip's state, bound to the browser that started it. */
const YOUTUBE_STATE_COOKIE = "glim_youtube_state";
const STATE_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/api/v1/admin/integrations/youtube",
} as const;
const BACK = "/admin/integrations";

/** The ops page, job dashboard and integrations (§15.3, §20.1). */
@Controller()
export class OpsController {
  constructor(
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(IntegrationsService) private readonly integrations: IntegrationsService,
    @Inject(GoogleIntegrationService) private readonly google: GoogleIntegrationService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  private get youtubeCallbackUrl(): string {
    return `${this.config.appOrigin}/api/v1/admin/integrations/youtube/callback`;
  }

  @Endpoint(ops.listOpsFailures)
  async failures(): Promise<Reply<typeof ops.listOpsFailures>> {
    return { items: await this.ops.failures() };
  }

  @Endpoint(ops.replayOpsFailure)
  async replay(
    @Params(ops.replayOpsFailure) params: ParamsOf<typeof ops.replayOpsFailure>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof ops.replayOpsFailure>> {
    return unwrap(
      await this.ops.replay(params.kind, params.id, { ...actor, userId: session.userId }),
    );
  }

  @Endpoint(ops.listQueues)
  async queues(): Promise<Reply<typeof ops.listQueues>> {
    return { items: await this.ops.queues() };
  }

  @Endpoint(ops.getYouTubeStatus)
  async youtube(): Promise<Reply<typeof ops.getYouTubeStatus>> {
    return {
      status: await this.ops.youtubeStatus(),
      channel: await this.integrations.youtubeChannel(),
    };
  }

  @Endpoint(ops.testYouTube)
  async testYoutube(
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof ops.testYouTube>> {
    await this.ops.requestYoutubeCheck({ ...actor, userId: session.userId });
    return {};
  }

  /** To Google's consent screen, as the channel's owner or manager (Appendix A.4 step 5). */
  @Endpoint(ops.connectYouTube)
  connectYoutube(@Res() reply: FastifyReply): void {
    const begun = this.integrations.beginYoutubeConnect(this.youtubeCallbackUrl);
    if (!begun.ok) return void reply.redirect(`${BACK}?youtube=unavailable`, 302);
    void reply.setCookie(YOUTUBE_STATE_COOKIE, begun.value.state, {
      ...STATE_COOKIE,
      maxAge: 600,
    });
    return void reply.redirect(begun.value.url, 302);
  }

  @Endpoint(ops.youTubeCallback)
  async youtubeCallback(
    @Query(ops.youTubeCallback) query: QueryOf<typeof ops.youTubeCallback>,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<void> {
    const expected = req.cookies[YOUTUBE_STATE_COOKIE];
    void reply.clearCookie(YOUTUBE_STATE_COOKIE, STATE_COOKIE);
    if (query.error !== undefined) return void reply.redirect(`${BACK}?youtube=declined`, 302);
    if (expected === undefined || query.state !== expected || query.code === undefined)
      return void reply.redirect(`${BACK}?youtube=failed`, 302);
    const done = await this.integrations.completeYoutubeConnect(
      query.code,
      this.youtubeCallbackUrl,
      { ...actor, userId: session.userId },
    );
    return void reply.redirect(`${BACK}?youtube=${done.ok ? "connected" : "failed"}`, 302);
  }

  @Endpoint(ops.disconnectYouTube)
  async disconnectYoutube(
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof ops.disconnectYouTube>> {
    await this.integrations.disconnectYoutube({ ...actor, userId: session.userId });
    return this.integrations.youtubeChannel();
  }

  @Endpoint(ops.getGoogleIntegration)
  googleIntegration(): Promise<Reply<typeof ops.getGoogleIntegration>> {
    return this.google.view();
  }

  @Endpoint(ops.saveGoogleIntegration)
  saveGoogle(
    @Body(ops.saveGoogleIntegration) body: BodyOf<typeof ops.saveGoogleIntegration>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof ops.saveGoogleIntegration>> {
    return this.google.save(body, { ...actor, userId: session.userId });
  }

  @Endpoint(ops.testGoogleIntegration)
  async testGoogle(
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof ops.testGoogleIntegration>> {
    unwrap(await this.google.requestCheck({ ...actor, userId: session.userId }));
    return {};
  }

  @Endpoint(ops.addHostAccount)
  async addHost(
    @Body(ops.addHostAccount) body: BodyOf<typeof ops.addHostAccount>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof ops.addHostAccount>> {
    return unwrap(await this.google.addHost(body, { ...actor, userId: session.userId }));
  }

  @Endpoint(ops.updateHostAccount)
  async updateHost(
    @Params(ops.updateHostAccount) params: ParamsOf<typeof ops.updateHostAccount>,
    @Body(ops.updateHostAccount) body: BodyOf<typeof ops.updateHostAccount>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof ops.updateHostAccount>> {
    return unwrap(
      await this.google.updateHost(params.id, body, { ...actor, userId: session.userId }),
    );
  }
}
