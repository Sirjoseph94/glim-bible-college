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
  type DomainError,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";

type GradeRow = typeof schema.grades.$inferSelect;
type AssessmentRow = typeof schema.assessments.$inferSelect;
type GradeSource = Grade["source"];
type GradeStatus = Grade["status"];

export interface GradeInput {
  score: string | null;
  feedbackMd?: string | null | undefined;
  reason?: string | undefined;
  excused?: boolean | undefined;
}

/** What a grade becomes; `feedbackMd` undefined keeps the current feedback. */
interface NextGrade {
  score: string | null;
  status: GradeStatus;
  source: GradeSource;
  feedbackMd?: string | null | undefined;
  gradedBy: string | null;
  releasedAt?: Date | null | undefined;
}

const SCORE = /^\d{1,5}(\.\d{1,2})?$/;

/** Sources of scores a person entered: never overwritten by a quiz score. */
const PAPER = new Set<string>(["MANUAL", "IMPORT"]);

/**
 * Whether a change moves a scored grade between the online path (QUIZ) and a score entered by a
 * person: the Lecturer chooses, with a reason (C-34).
 */
export function switchesPath(
  current: { source: string; score: string | null } | undefined,
  source: string,
  score: string | null,
): boolean {
  if (current === undefined || current.score === null || score === null) return false;
  return (current.source === "QUIZ") !== (source === "QUIZ");
}

/** Postgres numeric text ("72.50") ⇄ hundredths, exactly. */
const toHundredths = (value: string) => parseDecimal(value, 2);
const fromHundredths = (value: number) => formatDecimal(value, 2);

/**
 * Checks a score typed by a person against the column's maximum and normalises it ("7.5" →
 * "7.50"). Returns the error message when it isn't a valid score.
 */
export function normaliseScore(
  text: string,
  maxScore: string,
): { score: string } | { message: string; code: "invalid" | "too_big" } {
  const trimmed = text.trim();
  if (!SCORE.test(trimmed))
    return { message: "Use a number with at most two decimal places.", code: "invalid" };
  const hundredths = toHundredths(trimmed);
  if (hundredths > toHundredths(maxScore))
    return { message: `The score can't be more than ${maxScore}.`, code: "too_big" };
  return { score: fromHundredths(hundredths) };
}

/**
 * Grades (owner: assessment, TRD §14.2): one per assessment and student. Every change writes the
 * grade history and the audit log in the same transaction. Grades stay DRAFT, unseen by students,
 * until the column is released; a released grade that changes stays released and needs a reason.
 */
@Injectable()
export class GradesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Sets a score (0 to the assessment's maximum, two decimal places) and feedback, or excuses the
   * student. `expectedVersion` is the grade's version, or 0 when the caller believes there is no
   * grade yet.
   */
  async put(
    assessmentId: string,
    studentId: string,
    expectedVersion: number,
    input: GradeInput,
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<Grade>> {
    return this.db.withTxResult<Grade, DomainError>(async ({ db }) => {
      const a = schema.assessments;
      const [assessment] = await db.select().from(a).where(eq(a.id, assessmentId));
      if (assessment === undefined) return err(domainError("NOT_FOUND", "Not found."));
      if (!(await this.onCourse(db, assessment.courseOfferingId, studentId)))
        return err(domainError("NOT_FOUND", "Not found."));

      let score: string | null = null;
      if (input.score !== null && input.excused !== true) {
        const checked = normaliseScore(input.score, assessment.maxScore);
        if ("message" in checked)
          return err(
            domainError("VALIDATION_FAILED", checked.message, {
              fieldErrors: [{ path: "body.score", code: checked.code, message: checked.message }],
            }),
          );
        score = checked.score;
      }

      const current = await this.lock(db, assessmentId, studentId);
      if ((current?.version ?? 0) !== expectedVersion)
        return err(
          domainError("VERSION_MISMATCH", "Someone else changed this grade. Reload and try again."),
        );
      const status: GradeStatus =
        input.excused === true ? "EXCUSED" : current?.status === "RELEASED" ? "RELEASED" : "DRAFT";
      const changesRecord =
        current !== undefined && (current.score !== score || current.status !== status);
      // A score typed by hand is MANUAL (SUBMISSION for an assignment); feedback alone keeps the
      // grade's source, so commenting on an online exam score doesn't turn it into a paper one.
      const source: GradeSource =
        current !== undefined && current.score === score
          ? (current.source as GradeSource)
          : assessment.kind === "ASSIGNMENT"
            ? "SUBMISSION"
            : "MANUAL";
      const reasonNeeded =
        current?.status === "RELEASED" && changesRecord
          ? "Say why a released grade is changing."
          : switchesPath(current, source, score)
            ? "Say why you're replacing the online exam score."
            : null;
      if (reasonNeeded !== null && input.reason === undefined)
        return err(
          domainError("VALIDATION_FAILED", reasonNeeded, {
            fieldErrors: [{ path: "body.reason", code: "required", message: "Give a reason." }],
          }),
        );
      const row = await this.write(db, {
        assessment,
        studentId,
        current,
        next: {
          score,
          status,
          source,
          feedbackMd: input.feedbackMd,
          gradedBy: actor.userId,
          releasedAt: status === "RELEASED" ? current?.releasedAt : null,
        },
        changedBy: actor.userId,
        reason: input.reason ?? null,
        action: "assessment.grade.updated",
        actor,
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
    const score = fromHundredths(input.scoreX100);
    const current = await this.lock(db, input.assessmentId, input.studentId);
    if (current?.score === score && current.source === input.source) return;
    // A score the Lecturer entered (a paper exam, or an override) stays until they choose the
    // online score with a reason (C-34).
    if (current !== undefined && current.score !== null && PAPER.has(current.source)) return;
    const [assessment] = await db
      .select()
      .from(schema.assessments)
      .where(eq(schema.assessments.id, input.assessmentId));
    if (assessment === undefined) throw new Error("grade for a missing assessment");
    await this.write(db, {
      assessment,
      studentId: input.studentId,
      current,
      next: {
        score,
        // An excused student who takes the quiz anyway gets a score that waits for release.
        status: current?.status === "RELEASED" ? "RELEASED" : "DRAFT",
        source: input.source,
        gradedBy: current?.gradedBy ?? null,
        releasedAt: current?.status === "RELEASED" ? current.releasedAt : null,
      },
      changedBy: input.changedBy,
      reason: null,
      action: "assessment.grade.computed",
      actor: input.actor,
    });
  }

  /** Whether the student is (or was, COMPLETED) on the offering. */
  async onCourse(db: Database, offeringId: string, studentId: string): Promise<boolean> {
    const ce = schema.courseEnrollments;
    const [enrolled] = await db
      .select({ id: ce.id })
      .from(ce)
      .where(
        and(
          eq(ce.courseOfferingId, offeringId),
          eq(ce.studentId, studentId),
          inArray(ce.status, ["ENROLLED", "COMPLETED"]),
        ),
      )
      .limit(1);
    return enrolled !== undefined;
  }

  /** The grade row, locked for the rest of the transaction. */
  async lock(db: Database, assessmentId: string, studentId: string): Promise<GradeRow | undefined> {
    const g = schema.grades;
    const [row] = await db
      .select()
      .from(g)
      .where(and(eq(g.assessmentId, assessmentId), eq(g.studentId, studentId)))
      .for("update");
    return row;
  }

  /**
   * The one write path for grades: inserts or updates the row, then appends the grade history and
   * the audit entry in the same transaction. Feedback text stays out of the audit log.
   */
  async write(
    db: Database,
    input: {
      assessment: AssessmentRow;
      studentId: string;
      current: GradeRow | undefined;
      next: NextGrade;
      changedBy: string;
      reason: string | null;
      action: string;
      actor: AuditActor;
    },
  ): Promise<GradeRow> {
    const { assessment, current, next } = input;
    const g = schema.grades;
    const now = this.clock.now();
    const graded = next.score !== current?.score || next.source !== current.source;
    const [row] =
      current === undefined
        ? await db
            .insert(g)
            .values({
              courseOfferingId: assessment.courseOfferingId,
              assessmentId: assessment.id,
              studentId: input.studentId,
              score: next.score,
              source: next.source,
              status: next.status,
              feedbackMd: next.feedbackMd ?? null,
              gradedBy: next.gradedBy,
              gradedAt: now,
              releasedAt: next.releasedAt ?? null,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
        : await db
            .update(g)
            .set({
              score: next.score,
              source: next.source,
              status: next.status,
              ...(next.feedbackMd === undefined ? {} : { feedbackMd: next.feedbackMd }),
              gradedBy: next.gradedBy,
              ...(graded ? { gradedAt: now } : {}),
              releasedAt: next.releasedAt ?? null,
              updatedAt: now,
              version: sql`${g.version} + 1`,
            })
            .where(eq(g.id, current.id))
            .returning();
    if (row === undefined) throw new Error("grade write returned nothing");
    await db.insert(schema.gradeChanges).values({
      gradeId: row.id,
      oldScore: current?.score ?? null,
      newScore: row.score,
      oldStatus: current?.status ?? null,
      newStatus: row.status,
      oldSource: current?.source ?? null,
      newSource: row.source,
      changedBy: input.changedBy,
      reason: input.reason,
      createdAt: now,
    });
    await this.audit.record(db, input.actor, {
      action: input.action,
      resourceType: "grade",
      resourceId: row.id,
      metadata: {
        assessmentId: assessment.id,
        studentId: input.studentId,
        oldScore: current?.score ?? null,
        newScore: row.score,
        oldStatus: current?.status ?? null,
        newStatus: row.status,
        source: row.source,
        ...(input.reason === null ? {} : { reason: input.reason }),
      },
    });
    return row;
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
