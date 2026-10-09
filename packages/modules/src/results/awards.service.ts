import type { Award, AwardCandidate } from "@glim/contracts";
import { Db, schema, type AwardRequirement, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
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
import { toLocalDate } from "@glim/shared/time";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { awardClassFor, cumulativeGpa } from "./domain/grading";
import { rulesOf } from "./grading-schemes.service";
import { lineOf } from "./semester-results.service";

type Actor = AuditActor & { userId: string };

/** What a programme enrollment has earned toward its award. */
interface Assessment {
  cgpaX100: number;
  creditsEarnedX10: number;
  awardClass: string | null;
  requirements: AwardRequirement[];
  awardType: string;
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const x10 = (v: number) =>
  v % 10 === 0 ? String(v / 10) : `${String(Math.trunc(v / 10))}.${String(v % 10)}`;

/**
 * Awards (owner: results, TRD §14.6): the Registrar proposes an award, which works out the final
 * CGPA, credits and award class with a checklist of requirements, then confirms it, which gives it
 * a gap-free certificate number and graduates the student.
 */
@Injectable()
export class AwardsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /** Proposes (or re-proposes) the award; unmet requirements are listed, not refused. */
  async propose(programmeEnrollmentId: string, actor: Actor): Promise<DomainResult<Award>> {
    const result = await this.db.withTxResult<string, DomainError>(async ({ db }) => {
      const a = schema.awards;
      const [existing] = await db
        .select()
        .from(a)
        .where(eq(a.programmeEnrollmentId, programmeEnrollmentId))
        .for("update");
      if (existing?.status === "CONFERRED")
        return err(domainError("CONFLICT", "This award has already been conferred."));
      const assessed = await this.assess(db, programmeEnrollmentId);
      if (assessed === null) return notFound();
      const now = this.clock.now();
      const fields = {
        cgpaX100: assessed.cgpaX100,
        awardClass: assessed.awardClass,
        creditsEarnedX10: assessed.creditsEarnedX10,
        requirements: assessed.requirements,
        proposedBy: actor.userId,
        updatedAt: now,
      };
      const [row] =
        existing === undefined
          ? await db
              .insert(a)
              .values({ ...fields, programmeEnrollmentId, createdAt: now })
              .returning({ id: a.id })
          : await db
              .update(a)
              .set({ ...fields, version: sql`${a.version} + 1` })
              .where(eq(a.id, existing.id))
              .returning({ id: a.id });
      if (row === undefined) throw new Error("award write returned nothing");
      await this.audit.record(db, actor, {
        action: "results.award.proposed",
        resourceType: "award",
        resourceId: row.id,
        metadata: {
          programmeEnrollmentId,
          cgpaX100: assessed.cgpaX100,
          awardClass: assessed.awardClass,
          unmet: assessed.requirements.filter((x) => !x.met).map((x) => x.key),
        },
      });
      return ok(row.id);
    });
    return result.ok ? ok(await this.one(result.value)) : result;
  }

  /**
   * Confers the award, checking again first: every requirement met (`REQUIREMENTS_NOT_MET`) and
   * a CGPA that earns a class (`NO_AWARD`, checked first). Allocates the next certificate number for the award
   * type and year in the same transaction, completes the programme enrollment and graduates the
   * student unless another enrollment of theirs is still ACTIVE. Confirming again changes nothing.
   */
  async confirm(awardId: string, actor: Actor): Promise<DomainResult<Award>> {
    const result = await this.db.withTxResult<null, DomainError>(async (tx) => {
      const { db } = tx;
      const a = schema.awards;
      const [award] = await db.select().from(a).where(eq(a.id, awardId)).for("update");
      if (award === undefined) return notFound();
      if (award.status === "CONFERRED") return ok(null);
      const assessed = await this.assess(db, award.programmeEnrollmentId);
      if (assessed === null) return notFound();
      if (assessed.awardClass === null)
        return err(
          domainError(
            "NO_AWARD",
            `A final CGPA of ${(assessed.cgpaX100 / 100).toFixed(2)} earns no award.`,
          ),
        );

      const unmet = assessed.requirements.filter((x) => !x.met);
      if (unmet.length > 0)
        return err(
          domainError(
            "REQUIREMENTS_NOT_MET",
            `Not every requirement is met: ${unmet.map((x) => x.label).join("; ")}.`,
          ),
        );
      const now = this.clock.now();
      const [settings] = await db
        .select({ timezone: schema.settings.timezone })
        .from(schema.settings)
        .limit(1);
      const awardedOn = toLocalDate(now, settings?.timezone ?? "Africa/Lagos");
      const year = Number(awardedOn.slice(0, 4));
      const code = assessed.awardType === "CERTIFICATE" ? "CERT" : "DIP";
      const seq = schema.awardSequences;
      const [allocated] = await db
        .insert(seq)
        .values({ awardType: assessed.awardType, year, nextValue: 2 })
        .onConflictDoUpdate({
          target: [seq.awardType, seq.year],
          set: { nextValue: sql`${seq.nextValue} + 1` },
        })
        .returning({ value: sql<number>`${seq.nextValue} - 1` });
      if (allocated === undefined) throw new Error("certificate number allocation failed");
      const certificateNo = `GLIM/${code}/AWD/${String(year)}/${String(allocated.value).padStart(4, "0")}`;

      await db
        .update(a)
        .set({
          cgpaX100: assessed.cgpaX100,
          awardClass: assessed.awardClass,
          creditsEarnedX10: assessed.creditsEarnedX10,
          requirements: assessed.requirements,
          status: "CONFERRED",
          awardedOn,
          certificateNo,
          approvedBy: actor.userId,
          approvedAt: now,
          updatedAt: now,
          version: sql`${a.version} + 1`,
        })
        .where(eq(a.id, awardId));
      const pe = schema.programmeEnrollments;
      const [enrollment] = await db
        .update(pe)
        .set({
          status: "COMPLETED",
          endedOn: awardedOn,
          updatedAt: now,
          version: sql`${pe.version} + 1`,
        })
        .where(eq(pe.id, award.programmeEnrollmentId))
        .returning({ studentId: pe.studentId });
      if (enrollment === undefined) throw new Error("programme enrollment vanished");
      const [stillActive] = await db
        .select({ id: pe.id })
        .from(pe)
        .where(and(eq(pe.studentId, enrollment.studentId), eq(pe.status, "ACTIVE")))
        .limit(1);
      const st = schema.students;
      if (stillActive === undefined)
        await db
          .update(st)
          .set({ status: "GRADUATED", updatedAt: now, version: sql`${st.version} + 1` })
          .where(eq(st.id, enrollment.studentId));
      const [student] = await db
        .select({ userId: st.userId })
        .from(st)
        .where(eq(st.id, enrollment.studentId));
      if (student !== undefined)
        await this.notifications.notify(tx, {
          userId: student.userId,
          kind: "results.award-conferred",
          title: `Congratulations: your award (${assessed.awardClass}) has been conferred`,
          data: { awardId },
          email: false,
          dedupeKey: `award-conferred:${awardId}`,
        });
      await this.audit.record(db, actor, {
        action: "results.award.conferred",
        resourceType: "award",
        resourceId: awardId,
        metadata: {
          programmeEnrollmentId: award.programmeEnrollmentId,
          certificateNo,
          awardClass: assessed.awardClass,
          cgpaX100: assessed.cgpaX100,
          graduated: stillActive === undefined,
        },
      });
      return ok(null);
    });
    return result.ok ? ok(await this.one(awardId)) : result;
  }

  async list(status?: Award["status"]): Promise<Award[]> {
    const a = schema.awards;
    const rows = await this.db.read
      .select({ id: a.id })
      .from(a)
      .where(status === undefined ? undefined : eq(a.status, status))
      .orderBy(desc(a.updatedAt));
    return Promise.all(rows.map((r) => this.one(r.id)));
  }

  /** ACTIVE programme enrollments, with the CGPA of their latest semester result. */
  async candidates(programmeId?: string): Promise<AwardCandidate[]> {
    const pe = schema.programmeEnrollments;
    const st = schema.students;
    const p = schema.programmes;
    const rows = await this.db.read
      .select({
        id: pe.id,
        given: st.givenName,
        family: st.familyName,
        matricNumber: pe.matricNumber,
        programmeCode: p.code,
      })
      .from(pe)
      .innerJoin(st, eq(st.id, pe.studentId))
      .innerJoin(p, eq(p.id, pe.programmeId))
      .where(
        and(
          eq(pe.status, "ACTIVE"),
          programmeId === undefined ? undefined : eq(pe.programmeId, programmeId),
        ),
      )
      .orderBy(asc(p.code), asc(pe.matricNumber));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const sr = schema.semesterResults;
    const s = schema.semesters;
    const ses = schema.academicSessions;
    const latest = await this.db.read
      .select({
        id: sr.programmeEnrollmentId,
        cgpa: sr.cgpaX100,
        earned: sr.cumCreditsEarnedX10,
        startsOn: ses.startsOn,
        sequence: s.sequence,
      })
      .from(sr)
      .innerJoin(s, eq(s.id, sr.semesterId))
      .innerJoin(ses, eq(ses.id, s.academicSessionId))
      .where(inArray(sr.programmeEnrollmentId, ids))
      .orderBy(desc(ses.startsOn), desc(s.sequence));
    const a = schema.awards;
    const awards = await this.db.read
      .select({ id: a.id, status: a.status, pe: a.programmeEnrollmentId })
      .from(a)
      .where(inArray(a.programmeEnrollmentId, ids));
    return rows.map((r) => {
      const last = latest.find((x) => x.id === r.id);
      const award = awards.find((x) => x.pe === r.id);
      return {
        programmeEnrollmentId: r.id,
        studentName: `${r.given} ${r.family}`,
        matricNumber: r.matricNumber,
        programmeCode: r.programmeCode,
        cgpaX100: last?.cgpa ?? null,
        creditsEarnedX10: last?.earned ?? 0,
        award:
          award === undefined ? null : { id: award.id, status: award.status as Award["status"] },
      };
    });
  }

  /**
   * Works out the award from every non-draft result of the programme enrollment: the CGPA and
   * credits under the scheme's repeat policy, and the checklist — every compulsory course of the
   * curriculum passed (or exempted), the minimum elective credits, every semester published, no
   * result reopened, and a CGPA that earns a class.
   */
  private async assess(db: Database, programmeEnrollmentId: string): Promise<Assessment | null> {
    const pe = schema.programmeEnrollments;
    const p = schema.programmes;
    const [enrollment] = await db
      .select({
        curriculumId: pe.curriculumId,
        awardType: p.awardType,
        schemeId: p.gradingSchemeId,
        minElective: schema.curricula.minElectiveCredits,
      })
      .from(pe)
      .innerJoin(p, eq(p.id, pe.programmeId))
      .innerJoin(schema.curricula, eq(schema.curricula.id, pe.curriculumId))
      .where(eq(pe.id, programmeEnrollmentId));
    if (enrollment === undefined) return null;
    const [scheme] =
      enrollment.schemeId === null
        ? []
        : await db
            .select()
            .from(schema.gradingSchemes)
            .where(eq(schema.gradingSchemes.id, enrollment.schemeId));
    const rules = scheme === undefined ? null : rulesOf(scheme);

    const r = schema.courseResults;
    const results = await db
      .select({ result: r, code: schema.courses.code })
      .from(r)
      .innerJoin(schema.courses, eq(schema.courses.id, r.courseId))
      .where(and(eq(r.programmeEnrollmentId, programmeEnrollmentId), ne(r.status, "DRAFT")));
    const [reopened] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(r)
      .where(and(eq(r.programmeEnrollmentId, programmeEnrollmentId), eq(r.status, "DRAFT")));
    const cum = cumulativeGpa(
      results.map((x) => lineOf(x.result)),
      rules?.repeatPolicy ?? "BEST",
    );
    const cgpaX100 = cum.gpaX100 ?? 0;

    const cc = schema.curriculumCourses;
    const placements = await db
      .select({ courseId: cc.courseId, type: cc.courseType, code: schema.courses.code })
      .from(cc)
      .innerJoin(schema.courses, eq(schema.courses.id, cc.courseId))
      .where(eq(cc.curriculumId, enrollment.curriculumId))
      .orderBy(asc(schema.courses.code));
    const earned = new Map<string, number>();
    for (const { result } of results)
      if (result.passed === true || result.resultKind === "EXEMPT")
        earned.set(result.courseId, Math.max(earned.get(result.courseId) ?? 0, result.creditsX10));
    const compulsory = placements.filter((x) => x.type === "COMPULSORY");
    const missing = compulsory.filter((x) => !earned.has(x.courseId)).map((x) => x.code);
    const compulsoryIds = new Set(compulsory.map((x) => x.courseId));
    const electiveX10 = [...earned.entries()]
      .filter(([courseId]) => !compulsoryIds.has(courseId))
      .reduce((sum, [, credits]) => sum + credits, 0);
    const minElectiveX10 = parseDecimal(enrollment.minElective, 1);

    const sr = schema.semesterResults;
    const semesters = await db
      .select({ status: sr.status })
      .from(sr)
      .where(eq(sr.programmeEnrollmentId, programmeEnrollmentId));
    const unpublished = semesters.filter((x) => x.status !== "PUBLISHED").length;

    const requirements: AwardRequirement[] = [
      {
        key: "COMPULSORY",
        label: "Every compulsory course passed",
        met: missing.length === 0,
        detail: missing.length === 0 ? null : `Not yet passed: ${missing.join(", ")}`,
      },
      {
        key: "ELECTIVE_CREDITS",
        label: "Minimum elective credits",
        met: electiveX10 >= minElectiveX10,
        detail: `${x10(electiveX10)} of ${x10(minElectiveX10)} elective credits earned`,
      },
      {
        key: "PUBLISHED",
        label: "Every semester's results published",
        met: semesters.length > 0 && unpublished === 0 && (reopened?.n ?? 0) === 0,
        detail:
          semesters.length === 0
            ? "No semester results yet"
            : unpublished > 0 || (reopened?.n ?? 0) > 0
              ? `${String(unpublished)} semester(s) not published${(reopened?.n ?? 0) > 0 ? `; ${String(reopened?.n ?? 0)} result(s) reopened` : ""}`
              : null,
      },
      {
        key: "SCHEME",
        label: "The programme has a grading scheme",
        met: rules !== null,
        detail: null,
      },
    ];
    return {
      cgpaX100,
      creditsEarnedX10: cum.creditsEarnedX10,
      awardClass: rules === null ? null : awardClassFor(cum.gpaX100, rules),
      requirements,
      awardType: enrollment.awardType,
    };
  }

  private async one(id: string): Promise<Award> {
    const a = schema.awards;
    const pe = schema.programmeEnrollments;
    const st = schema.students;
    const p = schema.programmes;
    const [row] = await this.db.read
      .select({
        award: a,
        given: st.givenName,
        family: st.familyName,
        matricNumber: pe.matricNumber,
        programmeCode: p.code,
        programmeName: p.name,
      })
      .from(a)
      .innerJoin(pe, eq(pe.id, a.programmeEnrollmentId))
      .innerJoin(st, eq(st.id, pe.studentId))
      .innerJoin(p, eq(p.id, pe.programmeId))
      .where(eq(a.id, id));
    if (row === undefined) throw new Error(`award ${id} vanished`);
    return {
      id: row.award.id,
      programmeEnrollmentId: row.award.programmeEnrollmentId,
      studentName: `${row.given} ${row.family}`,
      matricNumber: row.matricNumber,
      programmeCode: row.programmeCode,
      programmeName: row.programmeName,
      cgpaX100: row.award.cgpaX100,
      awardClass: row.award.awardClass,
      creditsEarnedX10: row.award.creditsEarnedX10,
      requirements: row.award.requirements,
      status: row.award.status as Award["status"],
      awardedOn: row.award.awardedOn,
      certificateNo: row.award.certificateNo,
      version: row.award.version,
    };
  }
}
