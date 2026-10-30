import type { CohortResultRow, CohortResults } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { NotificationsService } from "@glim/modules/notifications";
import {
  CLOCK,
  domainError,
  err,
  formatDecimal,
  ok,
  type Clock,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { rulesOf } from "./grading-schemes.service";
import { summarize } from "./summary";

type Actor = AuditActor & { userId: string };
type ResultRow = typeof schema.courseResults.$inferSelect;

/** What the Registrar approves: one offering's results, or a whole cohort's. */
export type ApprovalScope = { offeringId: string } | { cohortId: string };

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/**
 * A cohort's results (owner: results, TRD §14.5, ADR-0005): each offering's progress from
 * finalized to approved, and each student's results with their CGPA. There are no semester
 * results: the Registrar approves course results, one offering or a whole cohort at a time, and
 * a CGPA stays Provisional until every result it counts is approved.
 */
@Injectable()
export class CohortResultsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /** The cohort's live offerings in date order and every student's results; null if none. */
  async view(cohortId: string, db: Database = this.db.read): Promise<CohortResults | null> {
    const c = schema.cohorts;
    const [cohort] = await db
      .select({ id: c.id, code: c.code, name: c.name, schemeId: schema.programmes.gradingSchemeId })
      .from(c)
      .innerJoin(schema.programmes, eq(schema.programmes.id, c.programmeId))
      .where(eq(c.id, cohortId));
    if (cohort === undefined) return null;

    const o = schema.courseOfferings;
    const course = schema.courses;
    const ce = schema.courseEnrollments;
    const r = schema.courseResults;
    const offerings = await db
      .select({
        offeringId: o.id,
        courseCode: course.code,
        title: sql<string>`coalesce(${o.titleOverride}, ${course.title})`,
        endsOn: o.endsOn,
        status: o.status,
        enrolled: sql<number>`(SELECT count(*) FROM ${ce} WHERE ${ce.courseOfferingId} = ${o.id} AND ${ce.status} IN ('ENROLLED', 'COMPLETED'))::int`,
        finalized: sql<number>`(SELECT count(*) FROM ${r} WHERE ${r.courseOfferingId} = ${o.id} AND ${r.status} IN ('FINALIZED', 'APPROVED'))::int`,
        approved: sql<number>`(SELECT count(*) FROM ${r} WHERE ${r.courseOfferingId} = ${o.id} AND ${r.status} = 'APPROVED')::int`,
      })
      .from(o)
      .innerJoin(course, eq(course.id, o.courseId))
      .where(and(eq(o.cohortId, cohortId), ne(o.status, "CANCELLED")))
      .orderBy(asc(o.startsOn));

    const pe = schema.programmeEnrollments;
    const st = schema.students;
    const students = await db
      .select({ id: pe.id, matricNumber: pe.matricNumber, given: st.givenName, family: st.familyName })
      .from(pe)
      .innerJoin(st, eq(st.id, pe.studentId))
      .where(eq(pe.cohortId, cohortId))
      .orderBy(asc(st.familyName), asc(st.givenName));
    const results: ResultRow[] =
      students.length === 0
        ? []
        : await db
            .select()
            .from(r)
            .where(
              and(
                inArray(
                  r.programmeEnrollmentId,
                  students.map((s) => s.id),
                ),
                ne(r.status, "DRAFT"),
              ),
            )
            .orderBy(asc(r.completedOn), asc(r.attemptNo));
    const [scheme] =
      cohort.schemeId === null
        ? []
        : await db
            .select()
            .from(schema.gradingSchemes)
            .where(eq(schema.gradingSchemes.id, cohort.schemeId));
    const rules = scheme === undefined ? null : rulesOf(scheme);

    const items: CohortResultRow[] = students.map((s) => {
      const mine = results.filter((x) => x.programmeEnrollmentId === s.id);
      const byOffering: CohortResultRow["results"] = {};
      for (const x of mine) {
        if (x.courseOfferingId === null) continue;
        byOffering[x.courseOfferingId] = {
          id: x.id,
          letter: x.letter,
          resultKind: x.resultKind as CohortResultRow["results"][string]["resultKind"],
          status: x.status as CohortResultRow["results"][string]["status"],
        };
      }
      return {
        programmeEnrollmentId: s.id,
        studentName: `${s.given} ${s.family}`,
        matricNumber: s.matricNumber,
        results: byOffering,
        summary: summarize(mine, rules),
      };
    });
    return {
      cohort: { id: cohort.id, code: cohort.code, name: cohort.name },
      offerings: offerings.map((x) => ({
        ...x,
        status: x.status as CohortResults["offerings"][number]["status"],
      })),
      items,
    };
  }

  /**
   * The broadsheet as CSV: one row per student with each offering's letter (in date order), then
   * credits, CGPA, standing and whether it's still Provisional. Figures are exact decimals.
   */
  broadsheetCsv(sheet: CohortResults): { headers: string[]; rows: string[][] } {
    const dec = (v: number | null, scale: number) => (v === null ? "" : formatDecimal(v, scale));
    return {
      headers: [
        "matric_number",
        "student",
        ...sheet.offerings.map((o) => o.courseCode),
        "credits_attempted",
        "credits_earned",
        "cgpa",
        "standing",
        "provisional",
      ],
      rows: sheet.items.map((x) => [
        x.matricNumber,
        x.studentName,
        ...sheet.offerings.map((o) => {
          const result = x.results[o.offeringId];
          return result === undefined ? "" : (result.letter ?? result.resultKind);
        }),
        dec(x.summary.creditsAttemptedX10, 1),
        dec(x.summary.creditsEarnedX10, 1),
        dec(x.summary.cgpaX100, 2),
        x.summary.standing,
        x.summary.provisional ? "yes" : "no",
      ]),
    };
  }

  /**
   * Approves the FINALIZED course results of an offering or of every offering of a cohort
   * (Registrar). Reopened (DRAFT) results are skipped until they're finalized again. Each student
   * with a newly approved result is told once. Approving again changes nothing.
   */
  approve(
    scope: ApprovalScope,
    actor: Actor,
  ): Promise<DomainResult<{ approved: number; skipped: number }>> {
    return this.db.withTxResult(async (tx) => {
      const { db } = tx;
      const o = schema.courseOfferings;
      const offeringIds =
        "offeringId" in scope
          ? (await db.select({ id: o.id }).from(o).where(eq(o.id, scope.offeringId))).map(
              (x) => x.id,
            )
          : (await db.select({ id: o.id }).from(o).where(eq(o.cohortId, scope.cohortId))).map(
              (x) => x.id,
            );
      if (offeringIds.length === 0) {
        if ("offeringId" in scope) return notFound();
        const [cohort] = await db
          .select({ id: schema.cohorts.id })
          .from(schema.cohorts)
          .where(eq(schema.cohorts.id, scope.cohortId));
        return cohort === undefined ? notFound() : ok({ approved: 0, skipped: 0 });
      }
      const r = schema.courseResults;
      const now = this.clock.now();
      const approved = await db
        .update(r)
        .set({
          status: "APPROVED",
          approvedBy: actor.userId,
          approvedAt: now,
          updatedAt: now,
          version: sql`${r.version} + 1`,
        })
        .where(and(inArray(r.courseOfferingId, offeringIds), eq(r.status, "FINALIZED")))
        .returning({ id: r.id, studentId: r.studentId });
      const [skipped] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(r)
        .where(and(inArray(r.courseOfferingId, offeringIds), eq(r.status, "DRAFT")));
      if (approved.length > 0) {
        const studentIds = [...new Set(approved.map((x) => x.studentId))];
        const users = await db
          .select({ id: schema.students.id, userId: schema.students.userId })
          .from(schema.students)
          .where(inArray(schema.students.id, studentIds));
        for (const u of users)
          await this.notifications.notify(tx, {
            userId: u.userId,
            kind: "results.course-approved",
            title: "The Registrar approved your results",
            data: {},
            email: false,
            dedupeKey: `course-approved:${u.id}:${String(now.getTime())}`,
          });
        await this.audit.record(db, actor, {
          action: "results.course.approved",
          resourceType: "offeringId" in scope ? "course_offering" : "cohort",
          resourceId: "offeringId" in scope ? scope.offeringId : scope.cohortId,
          metadata: { count: approved.length, courseResultIds: approved.map((x) => x.id) },
        });
        await tx.boss.publish(
          "results.course.approved",
          { ...scope, count: approved.length },
          { occurredAt: now, actorUserId: actor.userId },
        );
      }
      return ok({ approved: approved.length, skipped: skipped?.n ?? 0 });
    });
  }
}
