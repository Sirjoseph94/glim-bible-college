import { Db } from "@glim/db";
import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { PgBoss } from "pg-boss";
import { BOSS } from "../../common/tokens";

/** App Platform health checks (TRD §16 Health). Not part of the versioned API. */
@Controller()
export class HealthController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(BOSS) private readonly boss: PgBoss,
  ) {}

  @Get("/healthz")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("/readyz")
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const [database, queue] = await Promise.all([
      this.db.ping(),
      this.boss.getQueue("domain-event").then(
        (q) => q !== null,
        () => false,
      ),
    ]);
    const ok = database && queue;
    void reply.status(ok ? 200 : 503);
    return {
      status: ok ? "ok" : "unavailable",
      checks: { database: database ? "ok" : "down", queue: queue ? "ok" : "down" },
    };
  }
}
