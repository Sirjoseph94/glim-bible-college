import type { MyRegistration } from "@glim/contracts";
import { Db, schema, type Tx } from "@glim/db";
import { RoleService } from "@glim/modules/authorization";
import { NotificationsService } from "@glim/modules/notifications";
import { CLOCK, type Clock } from "@glim/shared";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";

/** What happened to one compulsory course for one student (§9.3 step 3). */
export interface CourseOutcome {
  courseId: string;
  courseCode: string;
  title: string;
  outcome: "REGISTERED" | "ALREADY_REGISTERED" | "NO_OFFERING";
  offeringId?: string;
}

const OPEN = ["REGISTRATION", "ACTIVE"];
const TEACHABLE = ["PUBLISHED", "ACTIVE"];

/**
 * Registration (owner: enrollment, TRD §9.3, AC-03). Opening a semester's registration creates
 * each eligible programme enrollment's semester enrollment and registers it for every compulsory
 * course of its Level and semester that has a published offering. It is idempotent, so it can be
 * re-run; students accepted later are registered inside their acceptance.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /**
   * The `semester.open-registration` job: every ACTIVE programme enrollment that started on or
   * before this semester's Academic Session, each in its own transaction. Courses with no published
   * offering are logged and the Academic Admins are told.
   */
  async openRegistration(
    semesterId: string,
  ): Promise<{ enrollments: number; registered: number; missing: string[] }> {
    const semester = await this.semester(semesterId);
    if (semester === null || !OPEN.includes(semester.status))
      return { enrollments: 0, registered: 0, missing: [] };
    const pe = schema.programmeEnrollments;
    const entry = schema.academicSessions;
    const eligible = await this.db.read
      .select({ id: pe.id })
      .from(pe)
      .innerJoin(entry, eq(entry.id, pe.entrySessionId))
      .where(and(eq(pe.status, "ACTIVE"), lte(entry.startsOn, semester.sessionStartsOn)))
      .orderBy(asc(pe.matricNumber));

    let registered = 0;
    const missing = new Map<string, CourseOutcome>();
    for (const { id } of eligible) {
      const outcomes = await this.db.withTx((tx) =>
        this.registerEnrollment(tx, semesterId, id, null),
      );
      for (const o of outcomes) {
        if (o.outcome === "REGISTERED") registered++;
        if (o.outcome === "NO_OFFERING") missing.set(o.courseId, o);
      }
    }
    if (missing.size > 0)
      await this.reportMissing(semesterId, semester.name, [...missing.values()]);
    return {
      enrollments: eligible.length,
      registered,
      missing: [...missing.values()].map((o) => o.courseCode),
    };
  }

  /**
   * Registers one programme enrollment for a semester inside the caller's transaction: the
   * semester enrollment at its current Level, then each compulsory course of that Level and
   * semester with a published offering (`selection = 'COMPULSORY'`). Safe to repeat.
   */
  async registerEnrollment(
    tx: Tx,
    semesterId: string,
    programmeEnrollmentId: string,
    actorUserId: string | null,
  ): Promise<CourseOutcome[]> {
    const { db } = tx;
    const pe = schema.programmeEnrollments;
    const [enrollment] = await db.select().from(pe).where(eq(pe.id, programmeEnrollmentId));
    const [semester] = await db
      .select({ sequence: schema.semesters.sequence })
      .from(schema.semesters)
      .where(eq(schema.semesters.id, semesterId));
    if (enrollment?.status !== "ACTIVE" || semester === undefined) return [];

    const cc = schema.curriculumCourses;
    const c = schema.courses;
    const placements = await db
      .select({ courseId: cc.courseId, courseType: cc.courseType, code: c.code, title: c.title })
      .from(cc)
      .innerJoin(c, eq(c.id, cc.courseId))
      .where(
        and(
          eq(cc.curriculumId, enrollment.curriculumId),
          eq(cc.levelNo, enrollment.currentLevel),
          eq(cc.semesterNo, semester.sequence),
        ),
      )
      .orderBy(asc(c.code));
    // Only programmes with something in this semester get a semester enrollment.
    if (placements.length === 0) return [];

    const se = schema.semesterEnrollments;
    await db
      .insert(se)
      .values({ programmeEnrollmentId, semesterId, levelNo: enrollment.currentLevel })
      .onConflictDoNothing();
    const [semesterEnrollment] = await db
      .select({ id: se.id, status: se.status })
      .from(se)
      .where(
        and(eq(se.programmeEnrollmentId, programmeEnrollmentId), eq(se.semesterId, semesterId)),
      );
    if (semesterEnrollment?.status !== "REGISTERED") return [];

    const compulsory = placements.filter((p) => p.courseType === "COMPULSORY");
    const o = schema.courseOfferings;
    const offerings =
      compulsory.length === 0
        ? []
        : await db
            .select({ id: o.id, courseId: o.courseId })
            .from(o)
            .where(
              and(
                eq(o.semesterId, semesterId),
                inArray(
                  o.courseId,
                  compulsory.map((p) => p.courseId),
                ),
                inArray(o.status, TEACHABLE),
              ),
            )
            .orderBy(asc(o.sectionCode));

    const now = this.clock.now();
    const outcomes: CourseOutcome[] = [];
    for (const placement of compulsory) {
      const base = {
        courseId: placement.courseId,
        courseCode: placement.code,
        title: placement.title,
      };
      const offering = offerings.find((x) => x.courseId === placement.courseId);
      if (offering === undefined) {
        outcomes.push({ ...base, outcome: "NO_OFFERING" });
        continue;
      }
      const [created] = await db
        .insert(schema.courseEnrollments)
        .values({
          semesterEnrollmentId: semesterEnrollment.id,
          programmeEnrollmentId,
          courseOfferingId: offering.id,
          studentId: enrollment.studentId,
          selection: "COMPULSORY",
          enrolledAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: schema.courseEnrollments.id });
      if (created === undefined) {
        outcomes.push({ ...base, outcome: "ALREADY_REGISTERED", offeringId: offering.id });
        continue;
      }
      await db.insert(schema.courseEnrollmentEvents).values({
        courseEnrollmentId: created.id,
        fromStatus: null,
        toStatus: "ENROLLED",
        actorUserId,
        reason: "Compulsory course, registered when registration opened",
        createdAt: now,
      });
      await tx.boss.publish(
        "course.enrollment.activated",
        {
          courseEnrollmentId: created.id,
          courseOfferingId: offering.id,
          studentId: enrollment.studentId,
        },
        { occurredAt: now, actorUserId },
      );
      outcomes.push({ ...base, outcome: "REGISTERED", offeringId: offering.id });
    }
    return outcomes;
  }

  /** The student's own programmes and registered courses, newest semester first (§9.3). */
  async forUser(userId: string): Promise<MyRegistration> {
    const db = this.db.read;
    const pe = schema.programmeEnrollments;
    const pr = schema.programmes;
    const programmes = await db
      .select({ enrollment: pe, code: pr.code, name: pr.name })
      .from(pe)
      .innerJoin(schema.students, eq(schema.students.id, pe.studentId))
      .innerJoin(pr, eq(pr.id, pe.programmeId))
      .where(eq(schema.students.userId, userId))
      .orderBy(desc(pe.startedOn));
    if (programmes.length === 0) return { programmes: [] };

    const se = schema.semesterEnrollments;
    const s = schema.semesters;
    const session = schema.academicSessions;
    const semesterRows = await db
      .select({ se, semester: s, sessionName: session.name })
      .from(se)
      .innerJoin(s, eq(s.id, se.semesterId))
      .innerJoin(session, eq(session.id, s.academicSessionId))
      .where(
        inArray(
          se.programmeEnrollmentId,
          programmes.map((p) => p.enrollment.id),
        ),
      )
      .orderBy(desc(s.startsOn));
    const ce = schema.courseEnrollments;
    const o = schema.courseOfferings;
    const c = schema.courses;
    const courseRows =
      semesterRows.length === 0
        ? []
        : await db
            .select({
              ce,
              code: c.code,
              title: c.title,
              override: o.titleOverride,
              credits: c.credits,
            })
            .from(ce)
            .innerJoin(o, eq(o.id, ce.courseOfferingId))
            .innerJoin(c, eq(c.id, o.courseId))
            .where(
              inArray(
                ce.semesterEnrollmentId,
                semesterRows.map((r) => r.se.id),
              ),
            )
            .orderBy(asc(c.code));

    return {
      programmes: programmes.map((p) => ({
        matricNumber: p.enrollment.matricNumber,
        programme: { code: p.code, name: p.name },
        studyMode: p.enrollment.studyMode as MyRegistration["programmes"][number]["studyMode"],
        currentLevel: p.enrollment.currentLevel,
        status: p.enrollment.status as MyRegistration["programmes"][number]["status"],
        semesters: semesterRows
          .filter((r) => r.se.programmeEnrollmentId === p.enrollment.id)
          .map((r) => ({
            semesterEnrollmentId: r.se.id,
            semester: {
              id: r.semester.id,
              name: r.semester.name,
              sessionName: r.sessionName,
              status: r.semester
                .status as MyRegistration["programmes"][number]["semesters"][number]["semester"]["status"],
              startsOn: r.semester.startsOn,
              endsOn: r.semester.endsOn,
            },
            levelNo: r.se.levelNo,
            courses: courseRows
              .filter((x) => x.ce.semesterEnrollmentId === r.se.id)
              .map((x) => ({
                courseEnrollmentId: x.ce.id,
                offeringId: x.ce.courseOfferingId,
                courseCode: x.code,
                title: x.override ?? x.title,
                credits: x.credits,
                selection: x.ce.selection as "COMPULSORY" | "ELECTIVE" | "MANUAL",
                status: x.ce.status as "ENROLLED" | "DROPPED" | "WITHDRAWN" | "COMPLETED",
              })),
          })),
      })),
    };
  }

  /** Ops warning plus an in-app notice to each Academic Admin, once per course and semester. */
  private async reportMissing(semesterId: string, semesterName: string, missing: CourseOutcome[]) {
    this.logger.warn(
      { semesterId, courses: missing.map((m) => m.courseCode) },
      "compulsory courses have no published offering",
    );
    await this.db.withTx(async (tx) => {
      for (const adminId of await this.roles.holders("ACADEMIC_ADMIN", tx.db)) {
        for (const course of missing) {
          await this.notifications.notify(tx, {
            userId: adminId,
            kind: "enrollment.registration.offering-missing",
            title: `${course.courseCode} has no published offering in ${semesterName}`,
            body: `Students due to take ${course.courseCode} ${course.title} couldn't be registered. Publish an offering, then re-run registration.`,
            data: { semesterId, courseId: course.courseId },
            email: false,
            dedupeKey: `offering-missing:${semesterId}:${course.courseId}`,
          });
        }
      }
    });
  }

  private async semester(id: string) {
    const s = schema.semesters;
    const session = schema.academicSessions;
    const [row] = await this.db.read
      .select({ name: s.name, status: s.status, sessionStartsOn: session.startsOn })
      .from(s)
      .innerJoin(session, eq(session.id, s.academicSessionId))
      .where(eq(s.id, id));
    return row ?? null;
  }
}
