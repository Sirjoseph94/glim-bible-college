import type { Grade, GradebookColumn, OnlineGrant } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import {
  CLOCK,
  domainError,
  err,
  formatDecimal,
  ok,
  type Clock,
  type DomainError,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, max } from "drizzle-orm";
import { attemptsScore } from "./exam-scores";
import { GradebookService } from "./gradebook.service";
import { GradesService, toGrade } from "./grades.service";

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/**
 * Hybrid exams (owner: assessment, TRD §14.2, C-34): one EXAM column with two ways in. On-campus
 * students sit it on paper and the Lecturer enters or imports their scores; Online students take
 * its timed online part, whose score is scaled to the exam's maximum. The Lecturer can let an
 * On-campus student sit online, and chooses (with a reason) when a student has both scores.
 */
@Injectable()
export class ExamsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(GradesService) private readonly grades: GradesService,
    @Inject(GradebookService) private readonly gradebook: GradebookService,
  ) {}

  /** An EXAM column, published straight away so paper scores can be entered. */
  async create(
    offeringId: string,
    input: { title: string; maxScore: string; weight: string; heldAt?: string | null | undefined },
    actor: AuditActor,
  ): Promise<GradebookColumn> {
    const id = await this.db.withTx(async ({ db }) => {
      const a = schema.assessments;
      const [last] = await db
        .select({ position: max(a.position) })
        .from(a)
        .where(eq(a.courseOfferingId, offeringId));
      const now = this.clock.now();
      const [row] = await db
        .insert(a)
        .values({
          courseOfferingId: offeringId,
          kind: "EXAM",
          title: input.title,
          maxScore: input.maxScore,
          weight: input.weight,
          position: (last?.position ?? -1) + 1,
          status: "PUBLISHED",
          dueAt: input.heldAt == null ? null : new Date(input.heldAt),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: a.id });
      if (row === undefined) throw new Error("assessment insert returned nothing");
      await this.audit.record(db, actor, {
        action: "assessment.exam.created",
        resourceType: "assessment",
        resourceId: row.id,
        metadata: {
          offeringId,
          title: input.title,
          maxScore: input.maxScore,
          weight: input.weight,
        },
      });
      return row.id;
    });
    return this.gradebook.column(id);
  }

  async grants(quizId: string): Promise<OnlineGrant[]> {
    const g = schema.examOnlineGrants;
    const st = schema.students;
    const z = schema.quizzes;
    const ce = schema.courseEnrollments;
    const pe = schema.programmeEnrollments;
    const rows = await this.db.read
      .selectDistinct({
        studentId: g.studentId,
        given: st.givenName,
        family: st.familyName,
        matricNumber: pe.matricNumber,
        reason: g.reason,
        createdAt: g.createdAt,
      })
      .from(g)
      .innerJoin(z, eq(z.id, g.quizId))
      .innerJoin(st, eq(st.id, g.studentId))
      .innerJoin(
        ce,
        and(eq(ce.studentId, g.studentId), eq(ce.courseOfferingId, z.courseOfferingId)),
      )
      .innerJoin(pe, eq(pe.id, ce.programmeEnrollmentId))
      .where(eq(g.quizId, quizId))
      .orderBy(asc(st.familyName), asc(st.givenName));
    return rows.map((r) => ({
      studentId: r.studentId,
      studentName: `${r.given} ${r.family}`,
      matricNumber: r.matricNumber,
      reason: r.reason,
      grantedAt: r.createdAt.toISOString(),
    }));
  }

  /** Lets a student on the course sit the online exam; granting again keeps the first grant. */
  async grant(
    quizId: string,
    studentId: string,
    reason: string,
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<OnlineGrant>> {
    const result = await this.db.withTxResult<null, DomainError>(async ({ db }) => {
      const quiz = await this.onlineExam(db, quizId);
      if (quiz === null) return notFound();
      if (quiz.eligibleStudyMode !== "ONLINE")
        return err(domainError("CONFLICT", "Everyone on the course can take this quiz already."));
      if (!(await this.grades.onCourse(db, quiz.courseOfferingId, studentId))) return notFound();
      const g = schema.examOnlineGrants;
      const [row] = await db
        .insert(g)
        .values({
          quizId,
          studentId,
          grantedBy: actor.userId,
          reason,
          createdAt: this.clock.now(),
        })
        .onConflictDoNothing()
        .returning({ id: g.id });
      if (row !== undefined)
        await this.audit.record(db, actor, {
          action: "assessment.exam.online-granted",
          resourceType: "quiz",
          resourceId: quizId,
          metadata: { studentId, reason },
        });
      return ok(null);
    });
    if (!result.ok) return result;
    const found = (await this.grants(quizId)).find((x) => x.studentId === studentId);
    return found === undefined ? notFound() : ok(found);
  }

  /** Withdraws an exception; an attempt already started carries on. */
  async revoke(quizId: string, studentId: string, actor: AuditActor): Promise<DomainResult<null>> {
    return this.db.withTxResult<null, DomainError>(async ({ db }) => {
      const g = schema.examOnlineGrants;
      const [row] = await db
        .delete(g)
        .where(and(eq(g.quizId, quizId), eq(g.studentId, studentId)))
        .returning({ id: g.id });
      if (row === undefined) return notFound();
      await this.audit.record(db, actor, {
        action: "assessment.exam.online-revoked",
        resourceType: "quiz",
        resourceId: quizId,
        metadata: { studentId },
      });
      return ok(null);
    });
  }

  /**
   * Replaces a paper (or hand-entered) score with the student's online exam score. A reason is
   * required and kept in the grade history and the audit log; a released grade stays released.
   */
  async useOnlineScore(
    assessmentId: string,
    studentId: string,
    expectedVersion: number,
    reason: string,
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<Grade>> {
    return this.db.withTxResult<Grade, DomainError>(async ({ db }) => {
      const a = schema.assessments;
      const [assessment] = await db.select().from(a).where(eq(a.id, assessmentId));
      if (assessment === undefined) return notFound();
      const [quiz] = await db
        .select()
        .from(schema.quizzes)
        .where(eq(schema.quizzes.assessmentId, assessmentId));
      if (quiz === undefined || !(await this.grades.onCourse(db, quiz.courseOfferingId, studentId)))
        return notFound();
      const current = await this.grades.lock(db, assessmentId, studentId);
      if ((current?.version ?? 0) !== expectedVersion)
        return err(
          domainError("VERSION_MISMATCH", "Someone else changed this grade. Reload and try again."),
        );
      const scoreX100 = await attemptsScore(db, quiz, studentId);
      if (scoreX100 === null)
        return err(domainError("CONFLICT", "This student has no marked online exam attempt."));
      const released = current?.status === "RELEASED";
      const row = await this.grades.write(db, {
        assessment,
        studentId,
        current,
        next: {
          score: formatDecimal(scoreX100, 2),
          status: released ? "RELEASED" : "DRAFT",
          source: "QUIZ",
          gradedBy: actor.userId,
          releasedAt: released ? current.releasedAt : null,
        },
        changedBy: actor.userId,
        reason,
        action: "assessment.grade.source-changed",
        actor,
      });
      return ok(toGrade(row));
    });
  }

  private async onlineExam(db: Database, quizId: string) {
    const [quiz] = await db.select().from(schema.quizzes).where(eq(schema.quizzes.id, quizId));
    return quiz ?? null;
  }
}
