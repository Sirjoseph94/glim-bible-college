import type { Award, AwardCandidate } from "@glim/contracts";
import { Db, schema, type AwardRequirement, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { NotificationsService } from "@glim/modules/notifications";
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
import { toLocalDate } from "@glim/shared/time";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  awardEligibility,
  isProvisional,
  passedCourses,
  type CurriculumCourse,
} from "./domain/awards";
import { awardClassFor, cumulativeGpa } from "./domain/grading";
import { rulesOf } from "./grading-schemes.service";
import { lineOf, summarize } from "./summary";

type Actor = AuditActor & { userId: string };
type AwardType = Award["awardType"];

type CurriculumCourses = (CurriculumCourse & { code: string })[];

/** The curriculum's courses with the credits each counts for (the override, or the course's). */
async function curriculumCourses(db: Database, curriculumId: string): Promise<CurriculumCourses> {
  const cc = schema.curriculumCourses;
  const c = schema.courses;
  const rows = await db
    .select({
      courseId: cc.courseId,
      code: c.code,
      override: cc.creditOverride,
      credits: c.credits,
    })
    .from(cc)
    .innerJoin(c, eq(c.id, cc.courseId))
    .where(eq(cc.curriculumId, curriculumId))
    .orderBy(asc(cc.position));
  return rows.map((r) => ({
    courseId: r.courseId,
    code: r.code,
    creditsX10: parseDecimal(r.override ?? r.credits, 1),
  }));
}

/** What a programme enrollment has earned toward one award. */
interface Assessment {
  cgpaX100: number;
  creditsEarnedX10: number;
  awardClass: string | null;
  requirements: AwardRequirement[];
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const x10 = (v: number) =>
  v % 10 === 0 ? String(v / 10) : `${String(Math.trunc(v / 10))}.${String(v % 10)}`;

/**
 * Awards (owner: results, TRD §14.6, ADR-0005): a Diploma student earns the Certificate once
 * they've passed courses worth half the curriculum's credits, and the Diploma once they've passed
 * every course. The Registrar proposes an award, which works out the CGPA, credits and award class
 * with a checklist of requirements, then confirms it, which gives it a gap-free certificate
 * number; conferring the Diploma also completes the programme and graduates the student.
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
  async propose(
    programmeEnrollmentId: string,
    awardType: AwardType,
    actor: Actor,
  ): Promise<DomainResult<Award>> {
    const result = await this.db.withTxResult<string, DomainError>(async ({ db }) => {
      const a = schema.awards;
      const [existing] = await db
        .select()
        .from(a)
        .where(and(eq(a.programmeEnrollmentId, programmeEnrollmentId), eq(a.awardType, awardType)))
        .for("update");
      if (existing?.status === "CONFERRED")
        return err(domainError("CONFLICT", "This award has already been conferred."));
      const assessed = await this.assess(db, programmeEnrollmentId, awardType);
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
              .values({ ...fields, programmeEnrollmentId, awardType, createdAt: now })
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
          awardType,
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
   * a CGPA that earns a class (`NO_AWARD`, checked first). Allocates the next certificate number
   * for the award type and year in the same transaction. The Diploma also completes the programme
   * enrollment and graduates the student unless another enrollment of theirs is still ACTIVE.
   * Confirming again changes nothing.
   */
  async confirm(awardId: string, actor: Actor): Promise<DomainResult<Award>> {
    const result = await this.db.withTxResult<null, DomainError>(async (tx) => {
      const { db } = tx;
      const a = schema.awards;
      const [award] = await db.select().from(a).where(eq(a.id, awardId)).for("update");
      if (award === undefined) return notFound();
      if (award.status === "CONFERRED") return ok(null);
      const awardType = award.awardType as AwardType;
      const assessed = await this.assess(db, award.programmeEnrollmentId, awardType);
      if (assessed === null) return notFound();
      if (assessed.awardClass === null)
        return err(
          domainError(
            "NO_AWARD",
            `A CGPA of ${formatDecimal(assessed.cgpaX100, 2)} earns no award.`,
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
      const code = awardType === "CERTIFICATE" ? "CERT" : "DIP";
      const seq = schema.awardSequences;
      const [allocated] = await db
        .insert(seq)
        .values({ awardType, year, nextValue: 2 })
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
        .select({ studentId: pe.studentId })
        .from(pe)
        .where(eq(pe.id, award.programmeEnrollmentId));
      if (enrollment === undefined) throw new Error("programme enrollment vanished");
      const st = schema.students;
      // The Certificate is earned halfway: only the Diploma ends the programme (ADR-0005).
      let graduated = false;
      if (awardType === "DIPLOMA") {
        await db
          .update(pe)
          .set({
            status: "COMPLETED",
            endedOn: awardedOn,
            updatedAt: now,
            version: sql`${pe.version} + 1`,
          })
          .where(eq(pe.id, award.programmeEnrollmentId));
        const [stillActive] = await db
          .select({ id: pe.id })
          .from(pe)
          .where(and(eq(pe.studentId, enrollment.studentId), eq(pe.status, "ACTIVE")))
          .limit(1);
        graduated = stillActive === undefined;
        if (graduated)
          await db
            .update(st)
            .set({ status: "GRADUATED", updatedAt: now, version: sql`${st.version} + 1` })
            .where(eq(st.id, enrollment.studentId));
      }
      const [student] = await db
        .select({ userId: st.userId })
        .from(st)
        .where(eq(st.id, enrollment.studentId));
      if (student !== undefined)
        await this.notifications.notify(tx, {
          userId: student.userId,
          kind: "results.award-conferred",
          title: `Congratulations: your ${awardType === "CERTIFICATE" ? "Certificate" : "Diploma"} (${assessed.awardClass}) has been conferred`,
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
          awardType,
          certificateNo,
          awardClass: assessed.awardClass,
          cgpaX100: assessed.cgpaX100,
          graduated,
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

  /**
   * ACTIVE programme enrollments (optionally one cohort), with their CGPA, the credits they've
   * passed towards the awards, which awards they're eligible for, and any awards proposed.
   */
  async candidates(cohortId?: string): Promise<AwardCandidate[]> {
    const pe = schema.programmeEnrollments;
    const st = schema.students;
    const p = schema.programmes;
    const c = schema.cohorts;
    const rows = await this.db.read
      .select({
        id: pe.id,
        curriculumId: pe.curriculumId,
        schemeId: p.gradingSchemeId,
        given: st.givenName,
        family: st.familyName,
        matricNumber: pe.matricNumber,
        programmeCode: p.code,
        cohortCode: c.code,
      })
      .from(pe)
      .innerJoin(st, eq(st.id, pe.studentId))
      .innerJoin(p, eq(p.id, pe.programmeId))
      .innerJoin(c, eq(c.id, pe.cohortId))
      .where(
        and(
          eq(pe.status, "ACTIVE"),
          cohortId === undefined ? undefined : eq(pe.cohortId, cohortId),
        ),
      )
      .orderBy(asc(c.code), asc(pe.matricNumber));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const r = schema.courseResults;
    const results = await this.db.read
      .select()
      .from(r)
      .where(and(inArray(r.programmeEnrollmentId, ids), ne(r.status, "DRAFT")));
    const schemeIds = [...new Set(rows.flatMap((x) => (x.schemeId === null ? [] : [x.schemeId])))];
    const schemes =
      schemeIds.length === 0
        ? []
        : await this.db.read
            .select()
            .from(schema.gradingSchemes)
            .where(inArray(schema.gradingSchemes.id, schemeIds));
    const curricula = new Map<string, CurriculumCourses>();
    for (const curriculumId of new Set(rows.map((x) => x.curriculumId)))
      curricula.set(curriculumId, await curriculumCourses(this.db.read, curriculumId));
    const a = schema.awards;
    const awards = await this.db.read
      .select({ id: a.id, awardType: a.awardType, status: a.status, pe: a.programmeEnrollmentId })
      .from(a)
      .where(inArray(a.programmeEnrollmentId, ids))
      .orderBy(asc(a.awardType));
    return rows.map((row) => {
      const scheme = schemes.find((x) => x.id === row.schemeId);
      const rules = scheme === undefined ? null : rulesOf(scheme);
      const mine = results.filter((x) => x.programmeEnrollmentId === row.id);
      const summary = summarize(mine, rules);
      const eligibility = awardEligibility(
        curricula.get(row.curriculumId) ?? [],
        mine.map(lineOf),
        rules?.repeatPolicy ?? "BEST",
      );
      return {
        programmeEnrollmentId: row.id,
        studentName: `${row.given} ${row.family}`,
        matricNumber: row.matricNumber,
        programmeCode: row.programmeCode,
        cohortCode: row.cohortCode,
        cgpaX100: summary.cgpaX100,
        creditsEarnedX10: eligibility.passedCreditsX10,
        totalCreditsX10: eligibility.totalCreditsX10,
        certificateEligible: eligibility.certificate,
        diplomaEligible: eligibility.diploma,
        awards: awards
          .filter((x) => x.pe === row.id)
          .map((x) => ({
            id: x.id,
            awardType: x.awardType as AwardType,
            status: x.status as Award["status"],
          })),
      };
    });
  }

  /**
   * Works out one award from every non-draft result of the programme enrollment: the CGPA under
   * the scheme's repeat policy, the award class, and the checklist. The Certificate needs passed
   * courses worth half the curriculum's credits, the Diploma every curriculum course passed (or
   * exempted); both need every counted result approved, none reopened, and a grading scheme.
   */
  private async assess(
    db: Database,
    programmeEnrollmentId: string,
    awardType: AwardType,
  ): Promise<Assessment | null> {
    const pe = schema.programmeEnrollments;
    const p = schema.programmes;
    const [enrollment] = await db
      .select({ curriculumId: pe.curriculumId, schemeId: p.gradingSchemeId })
      .from(pe)
      .innerJoin(p, eq(p.id, pe.programmeId))
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
      .select()
      .from(r)
      .where(and(eq(r.programmeEnrollmentId, programmeEnrollmentId), ne(r.status, "DRAFT")));
    const [reopened] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(r)
      .where(and(eq(r.programmeEnrollmentId, programmeEnrollmentId), eq(r.status, "DRAFT")));
    const lines = results.map(lineOf);
    const policy = rules?.repeatPolicy ?? "BEST";
    const cum = cumulativeGpa(lines, policy);
    const cgpaX100 = cum.gpaX100 ?? 0;

    const curriculum = await curriculumCourses(db, enrollment.curriculumId);
    const eligibility = awardEligibility(curriculum, lines, policy);
    const passed = passedCourses(curriculum, lines, policy);
    const missing = curriculum.filter((c) => !passed.has(c.courseId)).map((c) => c.code);
    const unapproved = isProvisional(results);
    const reopenedCount = reopened?.n ?? 0;

    const requirements: AwardRequirement[] = [
      awardType === "CERTIFICATE"
        ? {
            key: "HALF_CREDITS",
            label: "Courses worth half the curriculum's credits passed",
            met: eligibility.certificate,
            detail: `${x10(eligibility.passedCreditsX10)} of ${x10(eligibility.totalCreditsX10)} credits passed`,
          }
        : {
            key: "ALL_COURSES",
            label: "Every curriculum course passed",
            met: eligibility.diploma,
            detail: missing.length === 0 ? null : `Not yet passed: ${missing.join(", ")}`,
          },
      {
        key: "APPROVED",
        label: "Every result approved by the Registrar",
        met: !unapproved && reopenedCount === 0,
        detail:
          results.length === 0
            ? "No results yet"
            : unapproved || reopenedCount > 0
              ? [
                  unapproved ? "Some results aren't approved yet" : null,
                  reopenedCount > 0 ? `${String(reopenedCount)} result(s) reopened` : null,
                ]
                  .filter((x) => x !== null)
                  .join("; ")
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
      awardType: row.award.awardType as AwardType,
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
