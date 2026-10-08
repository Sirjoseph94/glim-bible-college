import { Db, schema } from "@glim/db";
import { AuditService } from "@glim/modules/audit";
import { CLOCK, type Clock } from "@glim/shared";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

/**
 * Year 1 → Year 2 progression (TRD §9.1, D-03). When an Academic Session is activated, every
 * ACTIVE enrollment at Level 1 on a programme with a second Level (the Diploma) that started in an
 * earlier session moves to Level 2. Retakes are registered manually, so there are no other rules.
 */
@Injectable()
export class ProgressionService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * The `academic.progression` job. Idempotent: only Level 1 enrollments move, so a rerun finds
   * nothing left to do. Does nothing unless the session is ACTIVE. Returns how many moved.
   */
  async run(sessionId: string): Promise<number> {
    const moved = await this.db.withTx(async ({ db }) => {
      const sessions = schema.academicSessions;
      const [session] = await db
        .select({ startsOn: sessions.startsOn, status: sessions.status })
        .from(sessions)
        .where(eq(sessions.id, sessionId));
      if (session?.status !== "ACTIVE") return [];

      const pe = schema.programmeEnrollments;
      const entry = alias(sessions, "entry_session");
      const due = await db
        .select({ id: pe.id })
        .from(pe)
        .innerJoin(schema.programmes, eq(schema.programmes.id, pe.programmeId))
        .innerJoin(entry, eq(entry.id, pe.entrySessionId))
        .where(
          and(
            eq(pe.status, "ACTIVE"),
            eq(pe.currentLevel, 1),
            gte(schema.programmes.levels, 2),
            lt(entry.startsOn, session.startsOn),
          ),
        )
        .for("update", { of: pe });
      const now = this.clock.now();
      for (const { id } of due) {
        await db
          .update(pe)
          .set({ currentLevel: 2, updatedAt: now, version: sql`${pe.version} + 1` })
          .where(eq(pe.id, id));
        await this.audit.record(
          db,
          { userId: null, type: "JOB" },
          {
            action: "enrollment.programme-enrollment.progressed",
            resourceType: "programme-enrollment",
            resourceId: id,
            metadata: { fromLevel: 1, toLevel: 2, academicSessionId: sessionId },
          },
        );
      }
      return due;
    });
    this.logger.info({ academicSessionId: sessionId, moved: moved.length }, "progression ran");
    return moved.length;
  }
}
