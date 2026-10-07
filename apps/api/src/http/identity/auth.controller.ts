import { auth, type BodyOf, type ResponseOf } from "@glim/contracts";
import {
  AuthService,
  MeService,
  type ActiveSession,
  type ClientMeta,
} from "@glim/modules/identity";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint } from "../../common/endpoint";
import { clearSessionCookie, setSessionCookie } from "./session-cookie";

function clientMeta(req: FastifyRequest): ClientMeta {
  return { ip: req.clientIp, userAgent: req.headers["user-agent"] };
}

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MeService) private readonly me: MeService,
  ) {}

  @Endpoint(auth.login)
  async login(
    @Body(auth.login) body: BodyOf<typeof auth.login>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ResponseOf<typeof auth.login>> {
    const signedIn = unwrap(
      await this.auth.login({
        ...body,
        ...clientMeta(req),
        previousSessionId: req.session?.sessionId,
      }),
    );
    setSessionCookie(reply, signedIn);
    return this.meFor(signedIn.session);
  }

  @Endpoint(auth.logout)
  async logout(
    @CurrentSession() session: ActiveSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(session.sessionId);
    clearSessionCookie(reply);
  }

  @Endpoint(auth.forgotPassword)
  async forgotPassword(@Body(auth.forgotPassword) body: BodyOf<typeof auth.forgotPassword>) {
    await this.auth.requestPasswordReset(body.email);
    return {};
  }

  @Endpoint(auth.resetPassword)
  async resetPassword(
    @Body(auth.resetPassword) body: BodyOf<typeof auth.resetPassword>,
  ): Promise<void> {
    unwrap(await this.auth.resetPassword(body));
  }

  @Endpoint(auth.acceptInvite)
  async acceptInvite(
    @Body(auth.acceptInvite) body: BodyOf<typeof auth.acceptInvite>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ResponseOf<typeof auth.acceptInvite>> {
    const signedIn = unwrap(await this.auth.acceptInvite({ ...body, ...clientMeta(req) }));
    setSessionCookie(reply, signedIn);
    return this.meFor(signedIn.session);
  }

  private async meFor(session: ActiveSession) {
    const me = await this.me.forSession(session);
    if (me === null) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    return me;
  }
}
