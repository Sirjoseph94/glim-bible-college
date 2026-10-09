import type { CourseResultRow, CourseResults, MyResults } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { GradebookService, lockStudents, unlockStudents } from "@glim/modules/assessment";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { PolicyService } from "@glim/modules/identity";
import { NotificationsService } from "@glim/modules/notifications";
import {
  CLOCK,
  domainError,
  err,
  ok,
  parseDecimal,
  type Clock,
  type DomainError,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  courseOutcome,
  cumulativeGpa,
  finalPercentX100,
  semesterGpa,
  standingFor,
  type ResultKind,
  type ResultLine,
  type RoundBeforeBanding,
} from "./domain/grading";
import { GradingSchemesService, rulesOf } from "./grading-schemes.service";
import { lineOf, SemesterResultsService } from "./semester-results.service";

type ResultRow = typeof schema.courseResults.$inferSelect;
type SchemeRow = typeof schema.gradingSchemes.$inferSelect;
type Actor = AuditActor & { userId: string };

/** What finalizing would record for one course enrollment. */
interface Computed {
  courseEnrollmentId: string;
  programmeEnrollmentId: string;
  studentId: string;
  userId: string;
  studentName: string;
  matricNumber: string;
  gradingSchemeId: string;
  creditsX10: number;
  finalPctX100: number | null;
  letter: string | null;
  pointsX100: number | null;
  qualityPointsX1000: number | null;
  resultKind: ResultKind;
  countsInGpa: boolean;
  passed: boolean | null;
  attemptNo: number;
}

interface Plan {
  offering: typeof schema.courseOfferings.$inferSelect;
  courseCode: string;
  courseTitle: string;
  blocker: string | null;
  computed: Computed[];
  existing: ResultRow[];
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const FINAL = ["FINALIZED", "APPROVED", "PUBLISHED"];

/**
 * Course results (owner: results, TRD §14.3): the PRIMARY Lecturer (or an Academic Admin)
 * finalizes a course, which freezes each student's result and locks their grades; the Registrar
 * can reopen one with a reason. Students see results as soon as they're finalized, with GPA and
 * CGPA Provisional until the semester is published.
 */
@Injectable()
export class CourseResultsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(GradebookService) private readonly gradebook: GradebookService,
    @Inject(GradingSchemesService) private readonly schemes: GradingSchemesService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(SemesterResultsService) private readonly semesters: SemesterResultsService,
  ) {}

  /** Each student's result, or a preview of what finalizing would record for them. */
  async list(offeringId: string): Promise<DomainResult<CourseResults>> {
    const plan = await this.plan(this.db.read, offeringId);
    if (plan === null) return notFound();
    return ok(this.view(plan));
  }

  /**
   * Finalizes every result not finalized yet: the published and closed columns' weights must
   * total exactly 100; a missing grade counts 0 (GRADING_DEFAULTS `missingGradeAsZero`); excused
   * columns drop out and the weights renormalise. Finalizing again only picks up results that
   * were reopened or students who joined since.
   */
  async finalize(offeringId: string, actor: Actor): Promise<DomainResult<CourseResults>> {
    const result = await this.db.withTxResult<null, DomainError>(async (tx) => {
      const { db } = tx;
      const [offering] = await db
        .select({ id: schema.courseOfferings.id })
        .from(schema.courseOfferings)
        .where(eq(schema.courseOfferings.id, offeringId))
        .for("update");
      if (offering === undefined) return notFound();
      const weights = await this.gradebook.checkWeights(db, offeringId);
      if (!weights.ok) return weights;
      const plan = await this.plan(db, offeringId);
      if (plan === null) return notFound();
      if (plan.blocker !== null) return err(domainError("CONFLICT", plan.blocker));

      const now = this.clock.now();
      const r = schema.courseResults;
      const done: Computed[] = [];
      for (const c of plan.computed) {
        const before = plan.existing.find((e) => e.courseEnrollmentId === c.courseEnrollmentId);
        if (before !== undefined && FINAL.includes(before.status)) continue;
        const fields = {
          programmeEnrollmentId: c.programmeEnrollmentId,
          semesterId: plan.offering.semesterId,
          courseOfferingId: offeringId,
          courseId: plan.offering.courseId,
          studentId: c.studentId,
          gradingSchemeId: c.gradingSchemeId,
          attemptNo: c.attemptNo,
          creditsX10: c.creditsX10,
          finalPctX100: c.finalPctX100,
          letter: c.letter,
          pointsX100: c.pointsX100,
          qualityPointsX1000: c.qualityPointsX1000,
          resultKind: c.resultKind,
          countsInGpa: c.countsInGpa,
          passed: c.passed,
          status: "FINALIZED",
          finalizedBy: actor.userId,
          finalizedAt: now,
          updatedAt: now,
        };
        const [row] =
          before === undefined
            ? await db
                .insert(r)
                .values({ ...fields, courseEnrollmentId: c.courseEnrollmentId, createdAt: now })
                .returning()
            : await db
                .update(r)
                .set({ ...fields, version: sql`${r.version} + 1` })
                .where(eq(r.id, before.id))
                .returning();
        if (row === undefined) throw new Error("course result write returned nothing");
        if (before !== undefined && before.reopenedCount > 0)
          await db.insert(schema.courseResultRevisions).values({
            courseResultId: row.id,
            changeKind: "REFINALIZE",
            oldValue: snapshot(before),
            newValue: snapshot(row),
            changedBy: actor.userId,
            reason: "Finalized again after reopening.",
            createdAt: now,
          });
        await this.schemes.lock(db, c.gradingSchemeId);
        done.push(c);
      }
      if (done.length === 0) return ok(null);
      await lockStudents(
        db,
        offeringId,
        done.map((c) => c.studentId),
        now,
      );
      for (const c of done)
        await this.notifications.notify(tx, {
          userId: c.userId,
          kind: "results.course-finalized",
          title: `${plan.courseCode}: your result is out`,
          data: { offeringId },
          email: false,
          dedupeKey: `course-finalized:${c.courseEnrollmentId}:${String(now.getTime())}`,
        });
      await this.audit.record(db, actor, {
        action: "results.course.finalized",
        resourceType: "course_offering",
        resourceId: offeringId,
        metadata: {
          count: done.length,
          courseEnrollmentIds: done.map((c) => c.courseEnrollmentId),
        },
      });
      return ok(null);
    });
    if (!result.ok) return result;
    return this.list(offeringId);
  }

  /**
   * Reopens a finalized result (Registrar or System Admin, with a reason): it goes back to DRAFT,
   * the student's grades on the course unlock, the change is kept in the result's revisions and
   * the audit log, and the student is told. Finalizing the course again records it afresh.
   */
  async reopen(
    resultId: string,
    reason: string,
    actor: Actor,
  ): Promise<DomainResult<CourseResultRow>> {
    const result = await this.db.withTxResult<string, DomainError>(async (tx) => {
      const { db } = tx;
      const r = schema.courseResults;
      const [row] = await db.select().from(r).where(eq(r.id, resultId)).for("update");
      if (row === undefined) return notFound();
      if (!FINAL.includes(row.status))
        return err(domainError("RESULT_NOT_FINALIZED", "This result isn't finalized."));
      if (row.courseOfferingId === null)
        return err(
          domainError("CONFLICT", "An imported result is corrected by importing it again."),
        );
      const now = this.clock.now();
      const [updated] = await db
        .update(r)
        .set({
          status: "DRAFT",
          approvedBy: null,
          approvedAt: null,
          publishedAt: null,
          reopenedCount: sql`${r.reopenedCount} + 1`,
          updatedAt: now,
          version: sql`${r.version} + 1`,
        })
        .where(eq(r.id, resultId))
        .returning();
      if (updated === undefined) throw new Error("reopen returned nothing");
      await db.insert(schema.courseResultRevisions).values({
        courseResultId: resultId,
        changeKind: "REOPEN",
        oldValue: snapshot(row),
        newValue: { status: "DRAFT" },
        changedBy: actor.userId,
        reason,
        createdAt: now,
      });
      await unlockStudents(db, row.courseOfferingId, [row.studentId]);
      // The semester's GPA (and every later CGPA) depend on it: back to DRAFT until recomputed.
      await this.semesters.reopenFrom(db, row.programmeEnrollmentId, row.semesterId);
      const [student] = await db
        .select({ userId: schema.students.userId })
        .from(schema.students)
        .where(eq(schema.students.id, row.studentId));
      const [course] = await db
        .select({ code: schema.courses.code })
        .from(schema.courses)
        .where(eq(schema.courses.id, row.courseId));
      if (student !== undefined)
        await this.notifications.notify(tx, {
          userId: student.userId,
          kind: "results.course-reopened",
          title: `${course?.code ?? ""}: your result is being reviewed`,
          data: { offeringId: row.courseOfferingId },
          email: false,
          dedupeKey: `course-reopened:${resultId}:${String(updated.reopenedCount)}`,
        });
      await this.audit.record(db, actor, {
        action: "results.course.reopened",
        resourceType: "course_result",
        resourceId: resultId,
        metadata: { reason, oldStatus: row.status, studentId: row.studentId },
      });
      return ok(row.courseOfferingId);
    });
    if (!result.ok) return result;
    const listed = await this.list(result.value);
    const found = listed.ok ? listed.value.items.find((x) => x.id === resultId) : undefined;
    if (found === undefined) throw new Error("reopened result vanished");
    return ok(found);
  }

  /**
   * The caller's finalized results by programme and semester, with semester GPA and CGPA worked
   * out on the fly from the programme's scheme, Provisional until the semester is published.
   */
  async mine(userId: string): Promise<MyResults> {
    const st = schema.students;
    const pe = schema.programmeEnrollments;
    const p = schema.programmes;
    const enrollments = await this.db.read
      .select({
        id: pe.id,
        matricNumber: pe.matricNumber,
        programmeName: p.name,
        schemeId: p.gradingSchemeId,
      })
      .from(pe)
      .innerJoin(st, eq(st.id, pe.studentId))
      .innerJoin(p, eq(p.id, pe.programmeId))
      .where(eq(st.userId, userId))
      .orderBy(asc(pe.startedOn));
    if (enrollments.length === 0) return { programmes: [] };
    const r = schema.courseResults;
    const c = schema.courses;
    const s = schema.semesters;
    const ses = schema.academicSessions;
    const rows = await this.db.read
      .select({
        result: r,
        courseCode: c.code,
        courseTitle: c.title,
        semesterName: s.name,
        sequence: s.sequence,
        sessionCode: ses.code,
        sessionStarts: ses.startsOn,
      })
      .from(r)
      .innerJoin(c, eq(c.id, r.courseId))
      .innerJoin(s, eq(s.id, r.semesterId))
      .innerJoin(ses, eq(ses.id, s.academicSessionId))
      .where(
        and(
          inArray(
            r.programmeEnrollmentId,
            enrollments.map((e) => e.id),
          ),
          ne(r.status, "DRAFT"),
        ),
      )
      .orderBy(asc(ses.startsOn), asc(s.sequence), asc(c.code));
    const published = await this.db.read
      .select({
        programmeEnrollmentId: schema.semesterResults.programmeEnrollmentId,
        semesterId: schema.semesterResults.semesterId,
      })
      .from(schema.semesterResults)
      .where(
        and(
          inArray(
            schema.semesterResults.programmeEnrollmentId,
            enrollments.map((e) => e.id),
          ),
          eq(schema.semesterResults.status, "PUBLISHED"),
        ),
      );
    const schemeIds = enrollments.flatMap((e) => (e.schemeId === null ? [] : [e.schemeId]));
    const schemes: SchemeRow[] =
      schemeIds.length === 0
        ? []
        : await this.db.read
            .select()
            .from(schema.gradingSchemes)
            .where(inArray(schema.gradingSchemes.id, schemeIds));
    return {
      programmes: enrollments.map((e) => {
        const scheme = schemes.find((x) => x.id === e.schemeId);
        const rules = scheme === undefined ? null : rulesOf(scheme);
        const mineRows = rows.filter((x) => x.result.programmeEnrollmentId === e.id);
        const semesterIds = [...new Set(mineRows.map((x) => x.result.semesterId))];
        const sofar: ResultLine[] = [];
        return {
          programmeEnrollmentId: e.id,
          programmeName: e.programmeName,
          matricNumber: e.matricNumber,
          semesters: semesterIds.map((semesterId) => {
            const inSemester = mineRows.filter((x) => x.result.semesterId === semesterId);
            const lines = inSemester.map((x) => lineOf(x.result));
            sofar.push(...lines);
            const term = semesterGpa(lines);
            const cumulative = cumulativeGpa(sofar, rules?.repeatPolicy ?? "BEST");
            const first = inSemester[0];
            return {
              semesterId,
              semesterName: first?.semesterName ?? "",
              sessionCode: first?.sessionCode ?? "",
              results: inSemester.map((x) => ({
                id: x.result.id,
                courseCode: x.courseCode,
                courseTitle: x.courseTitle,
                creditsX10: x.result.creditsX10,
                finalPctX100: x.result.finalPctX100,
                letter: x.result.letter,
                pointsX100: x.result.pointsX100,
                resultKind: x.result.resultKind as ResultKind,
                countsInGpa: x.result.countsInGpa,
                passed: x.result.passed,
                attemptNo: x.result.attemptNo,
                status: x.result.status as CourseResultRow["status"] & string,
              })),
              creditsAttemptedX10: term.creditsAttemptedX10,
              creditsEarnedX10: term.creditsEarnedX10,
              gpaX100: term.gpaX100,
              cgpaX100: cumulative.gpaX100,
              standing: rules === null ? "UNKNOWN" : standingFor(cumulative.gpaX100, rules),
              // Provisional until the Registrar publishes the semester result.
              provisional: !published.some(
                (x) => x.programmeEnrollmentId === e.id && x.semesterId === semesterId,
              ),
            };
          }),
        };
      }),
    };
  }

  // ---- helpers ----

  /** Works out every student's result on the course, and anything stopping finalization. */
  private async plan(db: Database, offeringId: string): Promise<Plan | null> {
    const o = schema.courseOfferings;
    const c = schema.courses;
    const [found] = await db
      .select({ offering: o, code: c.code, title: c.title, credits: c.credits })
      .from(o)
      .innerJoin(c, eq(c.id, o.courseId))
      .where(eq(o.id, offeringId));
    if (found === undefined) return null;
    const { config } = await this.policies.current("GRADING_DEFAULTS", db);
    const mode: RoundBeforeBanding = config.roundBeforeBanding;

    const a = schema.assessments;
    const columns = await db
      .select()
      .from(a)
      .where(and(eq(a.courseOfferingId, offeringId), inArray(a.status, ["PUBLISHED", "CLOSED"])));
    const ce = schema.courseEnrollments;
    const pe = schema.programmeEnrollments;
    const st = schema.students;
    const p = schema.programmes;
    const cc = schema.curriculumCourses;
    const roster = await db
      .select({
        courseEnrollmentId: ce.id,
        enrollmentType: ce.enrollmentType,
        programmeEnrollmentId: pe.id,
        studentId: st.id,
        userId: st.userId,
        given: st.givenName,
        family: st.familyName,
        matricNumber: pe.matricNumber,
        programmeCode: p.code,
        schemeId: p.gradingSchemeId,
        creditOverride: cc.creditOverride,
      })
      .from(ce)
      .innerJoin(pe, eq(pe.id, ce.programmeEnrollmentId))
      .innerJoin(st, eq(st.id, ce.studentId))
      .innerJoin(p, eq(p.id, pe.programmeId))
      .leftJoin(
        cc,
        and(eq(cc.curriculumId, pe.curriculumId), eq(cc.courseId, found.offering.courseId)),
      )
      .where(
        and(eq(ce.courseOfferingId, offeringId), inArray(ce.status, ["ENROLLED", "COMPLETED"])),
      )
      .orderBy(asc(st.familyName), asc(st.givenName));
    const r = schema.courseResults;
    const existing = await db.select().from(r).where(eq(r.courseOfferingId, offeringId));
    const g = schema.grades;
    const grades = await db.select().from(g).where(eq(g.courseOfferingId, offeringId));
    const schemeIds = [
      ...new Set(roster.flatMap((x) => (x.schemeId === null ? [] : [x.schemeId]))),
    ];
    const schemes: SchemeRow[] =
      schemeIds.length === 0
        ? []
        : await db
            .select()
            .from(schema.gradingSchemes)
            .where(inArray(schema.gradingSchemes.id, schemeIds));
    const earlier =
      roster.length === 0
        ? []
        : await db
            .select({ studentId: r.studentId, courseEnrollmentId: r.courseEnrollmentId })
            .from(r)
            .where(
              and(
                eq(r.courseId, found.offering.courseId),
                inArray(
                  r.studentId,
                  roster.map((x) => x.studentId),
                ),
              ),
            );

    let blocker: string | null = null;
    const weightTotal = columns.reduce((sum, col) => sum + parseDecimal(col.weight, 2), 0);
    if (weightTotal !== 10_000)
      blocker = `The published columns' weights add up to ${String(weightTotal / 100)} %, not 100 %.`;
    const computed: Computed[] = [];
    let missing = 0;
    for (const s of roster) {
      const scheme = schemes.find((x) => x.id === s.schemeId);
      if (scheme === undefined) {
        blocker ??= `The ${s.programmeCode} programme has no grading scheme yet. Ask the Registrar to choose one.`;
        continue;
      }
      const items = columns.map((col) => {
        const grade = grades.find((x) => x.assessmentId === col.id && x.studentId === s.studentId);
        if (grade?.score == null && grade?.status !== "EXCUSED") missing++;
        return {
          scoreX100:
            grade?.score != null
              ? parseDecimal(grade.score, 2)
              : config.missingGradeAsZero
                ? 0
                : null,
          maxX100: parseDecimal(col.maxScore, 2),
          weightX100: parseDecimal(col.weight, 2),
          excused: grade?.status === "EXCUSED",
        };
      });
      const creditsX10 = parseDecimal(s.creditOverride ?? found.credits, 1);
      const pct = finalPercentX100(items);
      const audit = s.enrollmentType === "AUDIT";
      const outcome = pct === null ? null : courseOutcome(rulesOf(scheme), pct, creditsX10, mode);
      const kind: ResultKind = pct === null ? "INCOMPLETE" : audit ? "AUDIT" : "GRADED";
      computed.push({
        courseEnrollmentId: s.courseEnrollmentId,
        programmeEnrollmentId: s.programmeEnrollmentId,
        studentId: s.studentId,
        userId: s.userId,
        studentName: `${s.given} ${s.family}`,
        matricNumber: s.matricNumber,
        gradingSchemeId: scheme.id,
        creditsX10,
        finalPctX100: pct,
        letter: outcome?.letter ?? null,
        pointsX100: outcome?.pointsX100 ?? null,
        qualityPointsX1000: outcome?.qualityPointsX1000 ?? null,
        resultKind: kind,
        countsInGpa: kind === "GRADED",
        passed: outcome?.passed ?? null,
        attemptNo:
          earlier.filter(
            (x) => x.studentId === s.studentId && x.courseEnrollmentId !== s.courseEnrollmentId,
          ).length + 1,
      });
    }
    if (!config.missingGradeAsZero && missing > 0)
      blocker ??= `${String(missing)} grades are missing. Enter them, or excuse the students.`;
    return {
      offering: found.offering,
      courseCode: found.code,
      courseTitle: found.title,
      blocker,
      computed,
      existing,
    };
  }

  private view(plan: Plan): CourseResults {
    const items: CourseResultRow[] = plan.computed.map((c) => {
      const row = plan.existing.find((e) => e.courseEnrollmentId === c.courseEnrollmentId);
      // A finalized result shows what was frozen; a draft or missing one shows the preview.
      if (row !== undefined && FINAL.includes(row.status))
        return {
          id: row.id,
          courseEnrollmentId: c.courseEnrollmentId,
          studentId: c.studentId,
          studentName: c.studentName,
          matricNumber: c.matricNumber,
          status: row.status as CourseResultRow["status"],
          creditsX10: row.creditsX10,
          finalPctX100: row.finalPctX100,
          letter: row.letter,
          pointsX100: row.pointsX100,
          qualityPointsX1000: row.qualityPointsX1000,
          resultKind: row.resultKind as ResultKind,
          countsInGpa: row.countsInGpa,
          passed: row.passed,
          attemptNo: row.attemptNo,
          finalizedAt: row.finalizedAt?.toISOString() ?? null,
          reopenedCount: row.reopenedCount,
          version: row.version,
        };
      return {
        id: row?.id ?? null,
        courseEnrollmentId: c.courseEnrollmentId,
        studentId: c.studentId,
        studentName: c.studentName,
        matricNumber: c.matricNumber,
        status: row === undefined ? null : (row.status as CourseResultRow["status"]),
        creditsX10: c.creditsX10,
        finalPctX100: c.finalPctX100,
        letter: c.letter,
        pointsX100: c.pointsX100,
        qualityPointsX1000: c.qualityPointsX1000,
        resultKind: c.resultKind,
        countsInGpa: c.countsInGpa,
        passed: c.passed,
        attemptNo: c.attemptNo,
        finalizedAt: null,
        reopenedCount: row?.reopenedCount ?? 0,
        version: row?.version ?? 0,
      };
    });
    return {
      blocker: plan.blocker,
      finalized: items.filter((i) => i.status !== null && FINAL.includes(i.status)).length,
      items,
    };
  }
}

/** The fields a revision keeps. */
function snapshot(row: ResultRow): Record<string, unknown> {
  return {
    status: row.status,
    finalPctX100: row.finalPctX100,
    letter: row.letter,
    pointsX100: row.pointsX100,
    qualityPointsX1000: row.qualityPointsX1000,
    creditsX10: row.creditsX10,
    passed: row.passed,
    resultKind: row.resultKind,
    gradingSchemeId: row.gradingSchemeId,
  };
}
