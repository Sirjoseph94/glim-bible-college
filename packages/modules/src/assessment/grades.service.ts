import type { Grade } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import {
  CLOCK,
  domainError,
  err,
  formatDecimal,
  ok,
  parseDecimal,
  type Clock,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";

type GradeRow = typeof schema.grades.$inferSelect;

export interface GradeInput {
  score: string | null;
  feedbackMd?: string | null | undefined;
  reason?: string | undefined;
}

const SCORE = /^\d{1,5}(\.\d{1,2})?$/;

/** Postgres numeric text ("72.50") ⇄ hundredths, exactly. */
const toHundredths = (value: string) => parseDecimal(value, 2);
const fromHundredths = (value: number) => formatDecimal(value, 2);

/**
 * Grades (owner: assessment, TRD §14.2): one per assessment and student. Every change writes the
 * grade history and the audit log in the same transaction. Grades stay DRAFT until released
 * (ticket 35), so students don't see them yet.
 */
@Injectable()
export class GradesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Sets a score (0 to the assessment's maximum, two decimal places) and feedback. `expectedVersion`
   * is the grade's version, or 0 when the caller believes there is no grade yet.
   */
  async put(
    assessmentId: string,
    studentId: string,
    expectedVersion: number,
    input: GradeInput,
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<Grade>> {
    return this.db.withTxResult(async ({ db }) => {
      const a = schema.assessments;
      const [assessment] = await db.select().from(a).where(eq(a.id, assessmentId));
      if (assessment === undefined) return err(domainError("NOT_FOUND", "Not found."));
      const ce = schema.courseEnrollments;
      const [enrolled] = await db
        .select({ id: ce.id })
        .from(ce)
        .where(
          and(
            eq(ce.courseOfferingId, assessment.courseOfferingId),
            eq(ce.studentId, studentId),
            inArray(ce.status, ["ENROLLED", "COMPLETED"]),
          ),
        );
      if (enrolled === undefined) return err(domainError("NOT_FOUND", "Not found."));

      let score: string | null = null;
      if (input.score !== null) {
        if (!SCORE.test(input.score))
          return err(
            domainError("VALIDATION_FAILED", "Use a number with at most two decimal places.", {
              fieldErrors: [{ path: "body.score", code: "invalid", message: "Not a score." }],
            }),
          );
        const hundredths = toHundredths(input.score);
        if (hundredths > toHundredths(assessment.maxScore))
          return err(
            domainError(
              "VALIDATION_FAILED",
              `The score can't be more than ${assessment.maxScore}.`,
              { fieldErrors: [{ path: "body.score", code: "too_big", message: "Too high." }] },
            ),
          );
        score = fromHundredths(hundredths);
      }

      const g = schema.grades;
      const [current] = await db
        .select()
        .from(g)
        .where(and(eq(g.assessmentId, assessmentId), eq(g.studentId, studentId)))
        .for("update");
      if ((current?.version ?? 0) !== expectedVersion)
        return err(
          domainError("VERSION_MISMATCH", "Someone else changed this grade. Reload and try again."),
        );
      const now = this.clock.now();
      const source = assessment.kind === "ASSIGNMENT" ? "SUBMISSION" : "MANUAL";
      let row: GradeRow | undefined;
      if (current === undefined) {
        [row] = await db
          .insert(g)
          .values({
            courseOfferingId: assessment.courseOfferingId,
            assessmentId,
            studentId,
            score,
            source,
            feedbackMd: input.feedbackMd ?? null,
            gradedBy: actor.userId,
            gradedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
      } else {
        [row] = await db
          .update(g)
          .set({
            score,
            source,
            ...(input.feedbackMd === undefined ? {} : { feedbackMd: input.feedbackMd }),
            gradedBy: actor.userId,
            gradedAt: now,
            updatedAt: now,
            version: sql`${g.version} + 1`,
          })
          .where(eq(g.id, current.id))
          .returning();
      }
      if (row === undefined) throw new Error("grade write returned nothing");
      await db.insert(schema.gradeChanges).values({
        gradeId: row.id,
        oldScore: current?.score ?? null,
        newScore: score,
        oldStatus: current?.status ?? null,
        newStatus: row.status,
        oldSource: current?.source ?? null,
        newSource: source,
        changedBy: actor.userId,
        reason: input.reason ?? null,
        createdAt: now,
      });
      // Scores only: feedback text stays out of the audit log.
      await this.audit.record(db, actor, {
        action: "assessment.grade.updated",
        resourceType: "grade",
        resourceId: row.id,
        metadata: {
          assessmentId,
          studentId,
          oldScore: current?.score ?? null,
          newScore: score,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
      });
      return ok(toGrade(row));
    });
  }

  /**
   * Writes a score the system worked out (a quiz's marked attempts), inside the caller's
   * transaction, with history and audit. `changedBy` is the person whose action produced it (the
   * student submitting, or the Lecturer marking an essay). Nothing changes if the score is the same.
   */
  async recordComputed(
    db: Database,
    input: {
      assessmentId: string;
      courseOfferingId: string;
      studentId: string;
      scoreX100: number;
      source: "QUIZ";
      changedBy: string;
      actor: AuditActor;
    },
  ): Promise<void> {
    const g = schema.grades;
    const score = fromHundredths(input.scoreX100);
    const [current] = await db
      .select()
      .from(g)
      .where(and(eq(g.assessmentId, input.assessmentId), eq(g.studentId, input.studentId)))
      .for("update");
    if (current?.score === score && current.source === input.source) return;
    const now = this.clock.now();
    const [row] =
      current === undefined
        ? await db
            .insert(g)
            .values({
              courseOfferingId: input.courseOfferingId,
              assessmentId: input.assessmentId,
              studentId: input.studentId,
              score,
              source: input.source,
              gradedAt: now,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
        : await db
            .update(g)
            .set({
              score,
              source: input.source,
              gradedAt: now,
              updatedAt: now,
              version: sql`${g.version} + 1`,
            })
            .where(eq(g.id, current.id))
            .returning();
    if (row === undefined) throw new Error("grade write returned nothing");
    await db.insert(schema.gradeChanges).values({
      gradeId: row.id,
      oldScore: current?.score ?? null,
      newScore: score,
      oldStatus: current?.status ?? null,
      newStatus: row.status,
      oldSource: current?.source ?? null,
      newSource: input.source,
      changedBy: input.changedBy,
      createdAt: now,
    });
    await this.audit.record(db, input.actor, {
      action: "assessment.grade.computed",
      resourceType: "grade",
      resourceId: row.id,
      metadata: {
        assessmentId: input.assessmentId,
        studentId: input.studentId,
        oldScore: current?.score ?? null,
        newScore: score,
        source: input.source,
      },
    });
  }
}

export function toGrade(row: GradeRow): Grade {
  return {
    id: row.id,
    score: row.score,
    feedbackMd: row.feedbackMd,
    source: row.source as Grade["source"],
    status: row.status as Grade["status"],
    gradedAt: row.gradedAt?.toISOString() ?? null,
    version: row.version,
  };
}
