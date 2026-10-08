import { auth, type QueryOf } from "@glim/contracts";
import {
  GOOGLE_FLOW_COOKIE,
  GOOGLE_FLOW_LIFETIME_MS,
  GoogleSignInService,
} from "@glim/modules/identity";
import { CONFIG, type Config } from "@glim/shared/config";
import { Controller, Inject, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { actorOf } from "../../common/auth.guard";
import { Endpoint, Query } from "../../common/endpoint";
import { setSessionCookie } from "./session-cookie";

const FLOW_COOKIE = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;

function withParam(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

/** Google sign-in and account linking (§8.1); every response is a redirect back into the SPA. */
@Controller()
export class GoogleController {
  constructor(
    @Inject(GoogleSignInService) private readonly google: GoogleSignInService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Endpoint(auth.googleStart)
  async start(
    @Query(auth.googleStart) query: QueryOf<typeof auth.googleStart>,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (query.intent === "link" && req.session === null) return void reply.redirect("/login", 302);
    const begun = await this.google.begin(query.intent, {
      userId: req.session?.userId ?? null,
      returnTo: query.returnTo,
    });
    if ("failure" in begun) {
      const back = { signin: "/login", link: "/profile", apply: "/apply" }[query.intent];
      return void reply.redirect(withParam(back, "error", begun.failure), 302);
    }
    void reply.setCookie(GOOGLE_FLOW_COOKIE, begun.flowCookie, {
      ...FLOW_COOKIE,
      maxAge: GOOGLE_FLOW_LIFETIME_MS / 1000,
    });
    return void reply.redirect(begun.redirectUrl, 302);
  }

  @Endpoint(auth.googleCallback)
  async callback(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const outcome = await this.google.complete(
      new URL(req.url, this.config.appOrigin),
      req.cookies[GOOGLE_FLOW_COOKIE],
      {
        currentUserId: req.session?.userId ?? null,
        previousSessionId: req.session?.sessionId ?? null,
        ip: req.clientIp,
        userAgent: req.headers["user-agent"],
        actor: actorOf(req),
      },
    );
    void reply.clearCookie(GOOGLE_FLOW_COOKIE, FLOW_COOKIE);
    switch (outcome.kind) {
      case "signed-in":
        setSessionCookie(reply, outcome.signedIn);
        return void reply.redirect(outcome.returnTo, 302);
      case "linked":
        return void reply.redirect(withParam(outcome.returnTo, "linked", "google"), 302);
      case "failed":
        return void reply.redirect(withParam(outcome.returnTo, "error", outcome.failure), 302);
    }
  }
}
