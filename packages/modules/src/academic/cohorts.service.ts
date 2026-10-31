import type { Cohort, EnumValue } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { domainError, err, ok, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { CurriculaService } from "./curricula.service";
import { layOutSchedule } from "./domain/schedule";
import { OfferingsService } from "./offerings.service";

export interface UnscheduledCourse {
  courseId: string;
  courseCode: string;
  courseTitle: string;
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/**
 * Cohorts: one programme's students starting in one intake (owner: academic, TRD §6.3), and their
 * Cohort Schedule: the curriculum's courses taught one after another in offerings dated for the
 * cohort (ADR-0005).
 */
@Injectable()
export class CohortsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CurriculaService) private readonly curricula: CurriculaService,
    @Inject(OfferingsService) private readonly offerings: OfferingsService,
  ) {}

  /** The cohort for a programme and intake, created by the first acceptance, e.g. "DIP-2027". */
  async getOrCreate(
    db: Database,
    input: {
      programme: { id: string; code: string; name: string };
      intake: { id: string; code: string };
    },
  ): Promise<string> {
    const c = schema.cohorts;
    await db
      .insert(c)
      .values({
        programmeId: input.programme.id,
        intakeId: input.intake.id,
        code: `${input.programme.code}-${input.intake.code}`,
        name: `${input.programme.name}, ${input.intake.code} intake`,
      })
      .onConflictDoNothing();
    const [row] = await db
      .select({ id: c.id })
      .from(c)
      .where(and(eq(c.programmeId, input.programme.id), eq(c.intakeId, input.intake.id)));
    if (row === undefined) throw new Error("cohort missing after insert");
    return row.id;
  }

  /** Cohorts, newest intake first, with their active students. */
  async list(status?: EnumValue<"cohorts.status">): Promise<Cohort[]> {
    return this.query(status === undefined ? undefined : eq(schema.cohorts.status, status));
  }

  async get(id: string): Promise<Cohort | null> {
    const [row] = await this.query(eq(schema.cohorts.id, id));
    return row ?? null;
  }

  /** The programme's ACTIVE curriculum courses the cohort has no live offering of, in order. */
  async unscheduled(cohortId: string, db: Database = this.db.read): Promise<UnscheduledCourse[]> {
    const [cohort] = await db
      .select({ programmeId: schema.cohorts.programmeId })
      .from(schema.cohorts)
      .where(eq(schema.cohorts.id, cohortId));
    if (cohort === undefined) return [];
    const curriculumId = await this.curricula.activeFor(cohort.programmeId, db);
    if (curriculumId === null) return [];
    const cc = schema.curriculumCourses;
    const course = schema.courses;
    const o = schema.courseOfferings;
    return db
      .select({ courseId: course.id, courseCode: course.code, courseTitle: course.title })
      .from(cc)
      .innerJoin(course, eq(course.id, cc.courseId))
      .leftJoin(
        o,
        and(eq(o.courseId, cc.courseId), eq(o.cohortId, cohortId), ne(o.status, "CANCELLED")),
      )
      .where(and(eq(cc.curriculumId, curriculumId), sql`${o.id} IS NULL`))
      .orderBy(asc(cc.position));
  }

  /**
   * Creates DRAFT offerings for every unscheduled curriculum course, end to end in curriculum
   * order from `startsOn`, each `weeksPerCourse` long with its exam on its last day. All or
   * nothing: one that would overlap an existing offering (OFFERING_OVERLAP) or start before the
   * cohort (BEFORE_INTAKE_START) stops the whole plan.
   */
  plan(
    cohortId: string,
    input: { startsOn: string; weeksPerCourse: number },
    actor: AuditActor,
  ): Promise<DomainResult<{ created: number }>> {
    return this.db.withTxResult(async ({ db, boss }) => {
      const [cohort] = await db
        .select({ id: schema.cohorts.id })
        .from(schema.cohorts)
        .where(eq(schema.cohorts.id, cohortId))
        .for("update");
      if (cohort === undefined) return notFound();
      const courses = await this.unscheduled(cohortId, db);
      const dates = layOutSchedule(input.startsOn, input.weeksPerCourse, courses.length);
      for (const [i, course] of courses.entries()) {
        const at = dates[i];
        if (at === undefined) throw new Error("schedule shorter than its courses");
        const created = await this.offerings.insert(
          db,
          boss,
          { courseId: course.courseId, cohortId, ...at, titleOverride: null, capacity: null },
          actor,
        );
        if (!created.ok) return created;
      }
      await this.audit.record(db, actor, {
        action: "academic.cohort.schedule-planned",
        resourceType: "cohort",
        resourceId: cohortId,
        metadata: { ...input, created: courses.length },
      });
      return ok({ created: courses.length });
    });
  }

  private async query(where: ReturnType<typeof eq> | undefined): Promise<Cohort[]> {
    const c = schema.cohorts;
    const i = schema.intakes;
    const p = schema.programmes;
    const pe = schema.programmeEnrollments;
    const rows = await this.db.read
      .select({
        cohort: c,
        programmeName: p.name,
        intakeCode: i.code,
        startsOn: i.startsOn,
        activeStudents: sql<number>`count(${pe.id}) FILTER (WHERE ${pe.status} = 'ACTIVE')::int`,
      })
      .from(c)
      .innerJoin(i, eq(i.id, c.intakeId))
      .innerJoin(p, eq(p.id, c.programmeId))
      .leftJoin(pe, eq(pe.cohortId, c.id))
      .where(where)
      .groupBy(c.id, i.id, p.id)
      .orderBy(desc(i.startsOn), asc(c.code));
    return rows.map((r) => ({
      id: r.cohort.id,
      programmeId: r.cohort.programmeId,
      programmeName: r.programmeName,
      intakeId: r.cohort.intakeId,
      intakeCode: r.intakeCode,
      startsOn: r.startsOn,
      code: r.cohort.code,
      name: r.cohort.name,
      status: r.cohort.status as EnumValue<"cohorts.status">,
      activeStudents: r.activeStudents,
    }));
  }
}
