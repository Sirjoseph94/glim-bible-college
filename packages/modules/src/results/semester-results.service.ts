import type { SemesterResultRow } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { NotificationsService } from "@glim/modules/notifications";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import {
  cumulativeGpa,
  semesterGpa,
  standingFor,
  type ResultKind,
  type ResultLine,
} from "./domain/grading";
import { rulesOf } from "./grading-schemes.service";

type ResultRow = typeof schema.courseResults.$inferSelect;
type Actor = AuditActor & { userId: string };

export interface SemesterScope {
  semesterId: string;
  programmeId?: string | undefined;
  cohortId?: string | undefined;
}

/** The figures a semester result stores; a change in any bumps `calc_version`. */
interface Figures {
  creditsAttemptedX10: number;
  creditsEarnedX10: number;
  qualityPointsX1000: number;
  gpaX100: number | null;
  cumCreditsAttemptedX10: number;
  cumCreditsEarnedX10: number;
  cumQualityPointsX1000: number;
  cgpaX100: number | null;
  standing: "GOOD" | "PROBATION" | "WITHDRAW_REQUIRED" | "UNKNOWN";
}

const FIGURES: (keyof Figures)[] = [
  "creditsAttemptedX10",
  "creditsEarnedX10",
  "qualityPointsX1000",
  "gpaX100",
  "cumCreditsAttemptedX10",
  "cumCreditsEarnedX10",
  "cumQualityPointsX1000",
  "cgpaX100",
  "standing",
];

/** A course result as GPA arithmetic sees it. */
export function lineOf(row: ResultRow): ResultLine {
  return {
    courseId: row.courseId,
    attemptOrder: row.attemptNo,
    creditsX10: row.creditsX10,
    pointsX100: row.pointsX100,
    qualityPointsX1000: row.qualityPointsX1000 ?? 0,
    resultKind: row.resultKind as ResultKind,
    countsInGpa: row.countsInGpa,
    passed: row.passed,
  };
}

/** Sorts semesters in teaching order: by Academic Session, then semester sequence. */
const semesterKey = (startsOn: string, sequence: number) =>
  `${startsOn}#${String(sequence).padStart(2, "0")}`;

/**
 * Semester results (owner: results, TRD §14.5). Computed from finalized (and imported) course
 * results per programme enrollment, so a Certificate's results never count toward the Diploma.
 * The Registrar approves and then publishes them in bulk; until then students see their GPA and
 * CGPA as Provisional.
 */
@Injectable()
export class SemesterResultsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /**
   * Upserts the semester results of every programme enrollment with a result in the semester
   * (optionally one programme), and of their later semesters, whose CGPA depends on it.
   * Idempotent: an unchanged result keeps its status and `calc_version`; a changed one goes back
   * to DRAFT with the next version.
   */
  async compute(
    semesterId: string,
    programmeId?: string,
  ): Promise<{ computed: number; changed: number }> {
    return this.db.withTx(async ({ db }) => {
      const r = schema.courseResults;
      const pe = schema.programmeEnrollments;
      const enrollments = await db
        .selectDistinct({ id: r.programmeEnrollmentId })
        .from(r)
        .innerJoin(pe, eq(pe.id, r.programmeEnrollmentId))
        .where(
          and(
            eq(r.semesterId, semesterId),
            ne(r.status, "DRAFT"),
            programmeId === undefined ? undefined : eq(pe.programmeId, programmeId),
          ),
        );
      let computed = 0;
      let changed = 0;
      for (const { id } of enrollments) {
        const outcome = await this.computeEnrollment(db, id, semesterId);
        computed += outcome.computed;
        changed += outcome.changed;
      }
      return { computed, changed };
    });
  }

  /**
   * Recomputes one programme enrollment from a semester on: that semester and every later one it
   * already has a semester result for.
   */
  async computeEnrollment(
    db: Database,
    programmeEnrollmentId: string,
    fromSemesterId: string,
  ): Promise<{ computed: number; changed: number }> {
    const pe = schema.programmeEnrollments;
    const [enrollment] = await db
      .select({ schemeId: schema.programmes.gradingSchemeId })
      .from(pe)
      .innerJoin(schema.programmes, eq(schema.programmes.id, pe.programmeId))
      .where(eq(pe.id, programmeEnrollmentId));
    const [scheme] =
      enrollment?.schemeId == null
        ? []
        : await db
            .select()
            .from(schema.gradingSchemes)
            .where(eq(schema.gradingSchemes.id, enrollment.schemeId));
    const rules = scheme === undefined ? null : rulesOf(scheme);

    const r = schema.courseResults;
    const s = schema.semesters;
    const ses = schema.academicSessions;
    const results = await db
      .select({ result: r, startsOn: ses.startsOn, sequence: s.sequence })
      .from(r)
      .innerJoin(s, eq(s.id, r.semesterId))
      .innerJoin(ses, eq(ses.id, s.academicSessionId))
      .where(and(eq(r.programmeEnrollmentId, programmeEnrollmentId), ne(r.status, "DRAFT")));
    const sr = schema.semesterResults;
    const existing = await db
      .select({ row: sr, startsOn: ses.startsOn, sequence: s.sequence })
      .from(sr)
      .innerJoin(s, eq(s.id, sr.semesterId))
      .innerJoin(ses, eq(ses.id, s.academicSessionId))
      .where(eq(sr.programmeEnrollmentId, programmeEnrollmentId));
    const [from] = await db
      .select({ startsOn: ses.startsOn, sequence: s.sequence })
      .from(s)
      .innerJoin(ses, eq(ses.id, s.academicSessionId))
      .where(eq(s.id, fromSemesterId));
    if (from === undefined) return { computed: 0, changed: 0 };
    const fromKey = semesterKey(from.startsOn, from.sequence);

    // The semesters to (re)compute: this one if it has results, and later ones already computed.
    const targets = new Map<string, string>();
    for (const x of results) {
      const k = semesterKey(x.startsOn, x.sequence);
      if (x.result.semesterId === fromSemesterId) targets.set(x.result.semesterId, k);
    }
    for (const x of existing) {
      const k = semesterKey(x.startsOn, x.sequence);
      if (k > fromKey) targets.set(x.row.semesterId, k);
    }

    const now = this.clock.now();
    let computed = 0;
    let changed = 0;
    for (const [semesterId, key] of targets) {
      const inSemester = results.filter((x) => x.result.semesterId === semesterId);
      const upTo = results.filter((x) => semesterKey(x.startsOn, x.sequence) <= key);
      const term = semesterGpa(inSemester.map((x) => lineOf(x.result)));
      const cum = cumulativeGpa(
        upTo.map((x) => lineOf(x.result)),
        rules?.repeatPolicy ?? "BEST",
      );
      const figures: Figures = {
        creditsAttemptedX10: term.creditsAttemptedX10,
        creditsEarnedX10: term.creditsEarnedX10,
        qualityPointsX1000: term.qualityPointsX1000,
        gpaX100: term.gpaX100,
        cumCreditsAttemptedX10: cum.creditsAttemptedX10,
        cumCreditsEarnedX10: cum.creditsEarnedX10,
        cumQualityPointsX1000: cum.qualityPointsX1000,
        cgpaX100: cum.gpaX100,
        standing: rules === null ? "UNKNOWN" : standingFor(cum.gpaX100, rules),
      };
      computed++;
      const before = existing.find((x) => x.row.semesterId === semesterId)?.row;
      if (before === undefined) {
        await db.insert(sr).values({
          programmeEnrollmentId,
          semesterId,
          ...figures,
          computedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        changed++;
        continue;
      }
      if (FIGURES.every((f) => before[f] === figures[f])) continue;
      changed++;
      await db
        .update(sr)
        .set({
          ...figures,
          status: "DRAFT",
          approvedBy: null,
          approvedAt: null,
          publishedAt: null,
          computedAt: now,
          calcVersion: sql`${sr.calcVersion} + 1`,
          updatedAt: now,
          version: sql`${sr.version} + 1`,
        })
        .where(eq(sr.id, before.id));
    }
    return { computed, changed };
  }

  /**
   * Moves a programme enrollment's semester results from this semester on back to DRAFT (a course
   * result was reopened, §14.3), inside the caller's transaction.
   */
  async reopenFrom(db: Database, programmeEnrollmentId: string, semesterId: string): Promise<void> {
    const sr = schema.semesterResults;
    const s = schema.semesters;
    const ses = schema.academicSessions;
    const [from] = await db
      .select({ startsOn: ses.startsOn, sequence: s.sequence })
      .from(s)
      .innerJoin(ses, eq(ses.id, s.academicSessionId))
      .where(eq(s.id, semesterId));
    if (from === undefined) return;
    const rows = await db
      .select({ id: sr.id, startsOn: ses.startsOn, sequence: s.sequence })
      .from(sr)
      .innerJoin(s, eq(s.id, sr.semesterId))
      .innerJoin(ses, eq(ses.id, s.academicSessionId))
      .where(and(eq(sr.programmeEnrollmentId, programmeEnrollmentId), ne(sr.status, "DRAFT")));
    const fromKey = semesterKey(from.startsOn, from.sequence);
    const ids = rows.filter((x) => semesterKey(x.startsOn, x.sequence) >= fromKey).map((x) => x.id);
    if (ids.length === 0) return;
    await db
      .update(sr)
      .set({
        status: "DRAFT",
        approvedBy: null,
        approvedAt: null,
        publishedAt: null,
        updatedAt: this.clock.now(),
        version: sql`${sr.version} + 1`,
      })
      .where(inArray(sr.id, ids));
  }

  async list(scope: SemesterScope): Promise<SemesterResultRow[]> {
    return this.rows(this.db.read, scope);
  }

  /**
   * Approves DRAFT semester results in scope with their course results (FINALIZED → APPROVED).
   * A student with a reopened (DRAFT) course result in the semester is skipped until it's
   * finalized and recomputed.
   */
  async approve(
    scope: SemesterScope,
    actor: Actor,
  ): Promise<DomainResult<{ approved: number; skipped: number }>> {
    return this.db.withTxResult(async ({ db }) => {
      const rows = (await this.rows(db, scope)).filter((x) => x.status === "DRAFT");
      const ready = rows.filter((x) => x.draftCourseResults === 0);
      if (ready.length > 0) {
        const now = this.clock.now();
        const sr = schema.semesterResults;
        await db
          .update(sr)
          .set({
            status: "APPROVED",
            approvedBy: actor.userId,
            approvedAt: now,
            updatedAt: now,
            version: sql`${sr.version} + 1`,
          })
          .where(
            inArray(
              sr.id,
              ready.map((x) => x.id),
            ),
          );
        const r = schema.courseResults;
        await db
          .update(r)
          .set({
            status: "APPROVED",
            approvedBy: actor.userId,
            approvedAt: now,
            updatedAt: now,
            version: sql`${r.version} + 1`,
          })
          .where(
            and(
              eq(r.semesterId, scope.semesterId),
              eq(r.status, "FINALIZED"),
              inArray(
                r.programmeEnrollmentId,
                ready.map((x) => x.programmeEnrollmentId),
              ),
            ),
          );
        await this.audit.record(db, actor, {
          action: "results.semester.approved",
          resourceType: "semester",
          resourceId: scope.semesterId,
          metadata: {
            count: ready.length,
            programmeId: scope.programmeId ?? null,
            cohortId: scope.cohortId ?? null,
            semesterResultIds: ready.map((x) => x.id),
          },
        });
      }
      return ok({ approved: ready.length, skipped: rows.length - ready.length });
    });
  }

  /** Publishes APPROVED semester results in scope with their course results, and tells students. */
  async publish(scope: SemesterScope, actor: Actor): Promise<DomainResult<{ published: number }>> {
    return this.db.withTxResult(async (tx) => {
      const { db } = tx;
      const rows = (await this.rows(db, scope)).filter((x) => x.status === "APPROVED");
      if (rows.length === 0) return ok({ published: 0 });
      const now = this.clock.now();
      const sr = schema.semesterResults;
      await db
        .update(sr)
        .set({
          status: "PUBLISHED",
          publishedAt: now,
          updatedAt: now,
          version: sql`${sr.version} + 1`,
        })
        .where(
          inArray(
            sr.id,
            rows.map((x) => x.id),
          ),
        );
      const r = schema.courseResults;
      await db
        .update(r)
        .set({
          status: "PUBLISHED",
          publishedAt: now,
          updatedAt: now,
          version: sql`${r.version} + 1`,
        })
        .where(
          and(
            eq(r.semesterId, scope.semesterId),
            eq(r.status, "APPROVED"),
            inArray(
              r.programmeEnrollmentId,
              rows.map((x) => x.programmeEnrollmentId),
            ),
          ),
        );
      const pe = schema.programmeEnrollments;
      const users = await db
        .select({ id: pe.id, userId: schema.students.userId })
        .from(pe)
        .innerJoin(schema.students, eq(schema.students.id, pe.studentId))
        .where(
          inArray(
            pe.id,
            rows.map((x) => x.programmeEnrollmentId),
          ),
        );
      const [semester] = await db
        .select({ name: schema.semesters.name, session: schema.academicSessions.code })
        .from(schema.semesters)
        .innerJoin(
          schema.academicSessions,
          eq(schema.academicSessions.id, schema.semesters.academicSessionId),
        )
        .where(eq(schema.semesters.id, scope.semesterId));
      for (const row of rows) {
        const userId = users.find((u) => u.id === row.programmeEnrollmentId)?.userId;
        if (userId === undefined) continue;
        await this.notifications.notify(tx, {
          userId,
          kind: "results.semester-published",
          title: `Your ${semester?.name ?? ""} ${semester?.session ?? ""} results are published`,
          data: { semesterId: scope.semesterId },
          email: false,
          dedupeKey: `semester-published:${row.id}:${String(now.getTime())}`,
        });
      }
      await this.audit.record(db, actor, {
        action: "results.semester.published",
        resourceType: "semester",
        resourceId: scope.semesterId,
        metadata: {
          count: rows.length,
          programmeId: scope.programmeId ?? null,
          cohortId: scope.cohortId ?? null,
          semesterResultIds: rows.map((x) => x.id),
        },
      });
      return ok({ published: rows.length });
    });
  }

  /** The broadsheet: every semester result in scope with the semester's name. */
  async broadsheet(scope: SemesterScope): Promise<
    DomainResult<{
      semester: { id: string; name: string; sessionCode: string };
      items: SemesterResultRow[];
    }>
  > {
    const [semester] = await this.db.read
      .select({
        id: schema.semesters.id,
        name: schema.semesters.name,
        sessionCode: schema.academicSessions.code,
      })
      .from(schema.semesters)
      .innerJoin(
        schema.academicSessions,
        eq(schema.academicSessions.id, schema.semesters.academicSessionId),
      )
      .where(eq(schema.semesters.id, scope.semesterId));
    if (semester === undefined) return err(domainError("NOT_FOUND", "Not found."));
    return ok({ semester, items: await this.rows(this.db.read, scope) });
  }

  /** The broadsheet as CSV columns and rows; figures printed as decimals. */
  broadsheetCsv(items: SemesterResultRow[]): { headers: string[]; rows: (string | number)[][] } {
    const dec = (v: number | null, scale: number) =>
      v === null ? "" : (v / scale).toFixed(scale === 10 ? 1 : 2);
    return {
      headers: [
        "matric_number",
        "student",
        "programme",
        "credits_attempted",
        "credits_earned",
        "gpa",
        "cum_credits_attempted",
        "cum_credits_earned",
        "cgpa",
        "standing",
        "status",
      ],
      rows: items.map((x) => [
        x.matricNumber,
        x.studentName,
        x.programmeCode,
        dec(x.creditsAttemptedX10, 10),
        dec(x.creditsEarnedX10, 10),
        dec(x.gpaX100, 100),
        dec(x.cumCreditsAttemptedX10, 10),
        dec(x.cumCreditsEarnedX10, 10),
        dec(x.cgpaX100, 100),
        x.standing,
        x.status,
      ]),
    };
  }

  private async rows(db: Database, scope: SemesterScope): Promise<SemesterResultRow[]> {
    const sr = schema.semesterResults;
    const pe = schema.programmeEnrollments;
    const st = schema.students;
    const p = schema.programmes;
    const where: (SQL | undefined)[] = [
      eq(sr.semesterId, scope.semesterId),
      scope.programmeId === undefined ? undefined : eq(pe.programmeId, scope.programmeId),
      scope.cohortId === undefined ? undefined : eq(pe.cohortId, scope.cohortId),
    ];
    const rows = await db
      .select({
        row: sr,
        given: st.givenName,
        family: st.familyName,
        matricNumber: pe.matricNumber,
        programmeCode: p.code,
        drafts: sql<number>`(SELECT count(*)::int FROM course_results cr
          WHERE cr.programme_enrollment_id = ${sr.programmeEnrollmentId}
            AND cr.semester_id = ${sr.semesterId} AND cr.status = 'DRAFT')`,
      })
      .from(sr)
      .innerJoin(pe, eq(pe.id, sr.programmeEnrollmentId))
      .innerJoin(st, eq(st.id, pe.studentId))
      .innerJoin(p, eq(p.id, pe.programmeId))
      .where(and(...where))
      .orderBy(asc(p.code), asc(pe.matricNumber));
    return rows.map((x) => ({
      id: x.row.id,
      programmeEnrollmentId: x.row.programmeEnrollmentId,
      studentName: `${x.given} ${x.family}`,
      matricNumber: x.matricNumber,
      programmeCode: x.programmeCode,
      semesterId: x.row.semesterId,
      creditsAttemptedX10: x.row.creditsAttemptedX10,
      creditsEarnedX10: x.row.creditsEarnedX10,
      gpaX100: x.row.gpaX100,
      cumCreditsAttemptedX10: x.row.cumCreditsAttemptedX10,
      cumCreditsEarnedX10: x.row.cumCreditsEarnedX10,
      cgpaX100: x.row.cgpaX100,
      standing: x.row.standing as SemesterResultRow["standing"],
      status: x.row.status as SemesterResultRow["status"],
      calcVersion: x.row.calcVersion,
      computedAt: x.row.computedAt.toISOString(),
      draftCourseResults: x.drafts,
    }));
  }
}
