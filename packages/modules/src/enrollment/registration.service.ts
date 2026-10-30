import type { MyRegistration } from "@glim/contracts";
import { Db, schema, type Database, type Tx, type TxQueue } from "@glim/db";
import { CLOCK, type Clock } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

const TEACHABLE = ["PUBLISHED", "ACTIVE"];

type Programmes = MyRegistration["programmes"];
type Course = Programmes[number]["courses"][number];

/**
 * Registration (owner: enrollment, TRD §9.3, ADR-0005). A cohort takes every course of its
 * curriculum, so there's nothing to choose: publishing an offering registers every ACTIVE student
 * of its cohort, and a student accepted later is registered for the cohort's current and
 * upcoming offerings inside their acceptance. Both are idempotent.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Registers every ACTIVE programme enrollment of the offering's cohort for it, inside the
   * publishing transaction (`selection = 'COHORT'`).
   */
  async registerCohort(
    db: Database,
    boss: TxQueue,
    offering: { id: string; cohortId: string },
  ): Promise<number> {
    const pe = schema.programmeEnrollments;
    const students = await db
      .select({ id: pe.id, studentId: pe.studentId })
      .from(pe)
      .where(and(eq(pe.cohortId, offering.cohortId), eq(pe.status, "ACTIVE")))
      .orderBy(asc(pe.matricNumber));
    let registered = 0;
    for (const s of students) {
      const created = await this.enroll(
        { db, boss },
        { programmeEnrollmentId: s.id, studentId: s.studentId, offeringId: offering.id },
        "Registered with the cohort when the offering was published",
        null,
      );
      if (created) registered++;
    }
    return registered;
  }

  /**
   * Registers one programme enrollment for its cohort's published and running offerings, inside
   * the caller's transaction (acceptance). Courses the cohort already finished are left for a
   * manual registration later. Safe to repeat.
   */
  async registerEnrollment(
    tx: Tx,
    programmeEnrollmentId: string,
    actorUserId: string | null,
  ): Promise<number> {
    const { db } = tx;
    const pe = schema.programmeEnrollments;
    const [enrollment] = await db.select().from(pe).where(eq(pe.id, programmeEnrollmentId));
    if (enrollment?.status !== "ACTIVE") return 0;
    const o = schema.courseOfferings;
    const offerings = await db
      .select({ id: o.id })
      .from(o)
      .where(and(eq(o.cohortId, enrollment.cohortId), inArray(o.status, TEACHABLE)))
      .orderBy(asc(o.startsOn));
    let registered = 0;
    for (const offering of offerings) {
      const created = await this.enroll(
        tx,
        { programmeEnrollmentId, studentId: enrollment.studentId, offeringId: offering.id },
        "Registered with the cohort on acceptance",
        actorUserId,
      );
      if (created) registered++;
    }
    return registered;
  }

  /** The student's own programmes and their courses in date order (§9.3). */
  async forUser(userId: string): Promise<MyRegistration> {
    const db = this.db.read;
    const pe = schema.programmeEnrollments;
    const pr = schema.programmes;
    const cohort = schema.cohorts;
    const programmes = await db
      .select({ enrollment: pe, code: pr.code, name: pr.name, cohort })
      .from(pe)
      .innerJoin(schema.students, eq(schema.students.id, pe.studentId))
      .innerJoin(pr, eq(pr.id, pe.programmeId))
      .innerJoin(cohort, eq(cohort.id, pe.cohortId))
      .where(eq(schema.students.userId, userId))
      .orderBy(desc(pe.startedOn));
    if (programmes.length === 0) return { programmes: [] };

    const ce = schema.courseEnrollments;
    const o = schema.courseOfferings;
    const c = schema.courses;
    const m = schema.examMakeups;
    const courseRows = await db
      .select({ ce, offering: o, code: c.code, title: c.title, credits: c.credits, makeupOn: m.makeupOn })
      .from(ce)
      .innerJoin(o, eq(o.id, ce.courseOfferingId))
      .innerJoin(c, eq(c.id, o.courseId))
      .leftJoin(m, and(eq(m.courseOfferingId, o.id), eq(m.studentId, ce.studentId)))
      .where(
        inArray(
          ce.programmeEnrollmentId,
          programmes.map((p) => p.enrollment.id),
        ),
      )
      .orderBy(asc(o.startsOn), asc(c.code));

    return {
      programmes: programmes.map((p) => ({
        matricNumber: p.enrollment.matricNumber,
        programme: { code: p.code, name: p.name },
        cohort: { id: p.cohort.id, code: p.cohort.code, name: p.cohort.name },
        studyMode: p.enrollment.studyMode as Programmes[number]["studyMode"],
        status: p.enrollment.status as Programmes[number]["status"],
        courses: courseRows
          .filter((x) => x.ce.programmeEnrollmentId === p.enrollment.id)
          .map(
            (x): Course => ({
              courseEnrollmentId: x.ce.id,
              offeringId: x.ce.courseOfferingId,
              courseCode: x.code,
              title: x.offering.titleOverride ?? x.title,
              credits: x.credits,
              startsOn: x.offering.startsOn,
              endsOn: x.offering.endsOn,
              examOn: x.offering.examOn,
              makeupOn: x.makeupOn,
              offeringStatus: x.offering.status as Course["offeringStatus"],
              selection: x.ce.selection as Course["selection"],
              status: x.ce.status as Course["status"],
            }),
          ),
      })),
    };
  }

  /** One cohort registration, with its event row and `course.enrollment.activated`. */
  private async enroll(
    tx: { db: Database; boss: TxQueue },
    who: { programmeEnrollmentId: string; studentId: string; offeringId: string },
    reason: string,
    actorUserId: string | null,
  ): Promise<boolean> {
    const now = this.clock.now();
    const [created] = await tx.db
      .insert(schema.courseEnrollments)
      .values({
        programmeEnrollmentId: who.programmeEnrollmentId,
        courseOfferingId: who.offeringId,
        studentId: who.studentId,
        selection: "COHORT",
        enrolledAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: schema.courseEnrollments.id });
    if (created === undefined) return false;
    await tx.db.insert(schema.courseEnrollmentEvents).values({
      courseEnrollmentId: created.id,
      fromStatus: null,
      toStatus: "ENROLLED",
      actorUserId,
      reason,
      createdAt: now,
    });
    await tx.boss.publish(
      "course.enrollment.activated",
      {
        courseEnrollmentId: created.id,
        courseOfferingId: who.offeringId,
        studentId: who.studentId,
      },
      { occurredAt: now, actorUserId },
    );
    return true;
  }
}
