import type { RosterItem, SemesterRegistration } from "@glim/contracts";
import { Db, PG, pgError, schema, type Database, type Tx } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { SettingsService } from "@glim/modules/identity";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

type Actor = AuditActor & { userId: string };
type CourseEnrollmentRow = typeof schema.courseEnrollments.$inferSelect;

const OPEN = ["REGISTRATION", "ACTIVE"];
const TEACHABLE = ["PUBLISHED", "ACTIVE"];
const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/**
 * Course enrollments after registration opens (owner: enrollment, TRD §9.3): students add and
 * drop electives within the add/drop window; the Academic Admin registers students manually
 * (e.g. retakes, D-03) and withdraws them, with reasons. Capacity is checked under a row lock on
 * the offering. Every change writes `course_enrollment_events`.
 */
@Injectable()
export class CourseEnrollmentsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async registration(semesterEnrollmentId: string): Promise<SemesterRegistration | null> {
    const today = await this.settings.today();
    return this.view(this.db.read, semesterEnrollmentId, today);
  }

  /** Adds an ELECTIVE placement of the student's Level and semester that has an offering. */
  async addElective(
    semesterEnrollmentId: string,
    offeringId: string,
    actor: Actor,
  ): Promise<DomainResult<SemesterRegistration>> {
    const today = await this.settings.today();
    return this.guarded(async (tx) => {
      const context = await this.context(tx.db, semesterEnrollmentId);
      if (context === null) return notFound();
      if (!windowOpen(context.semester, today)) return closed();
      const electives = await this.availableElectives(tx.db, context);
      if (!electives.some((e) => e.offeringId === offeringId))
        return err(
          domainError(
            "ELECTIVE_NOT_AVAILABLE",
            "That isn't an elective for your Level and semester.",
          ),
        );
      if (await this.alreadyEnrolled(tx.db, context.enrollment.studentId, offeringId))
        return alreadyEnrolled();
      const full = await this.lockAndCheckCapacity(tx.db, offeringId);
      if (full) return full;
      const created = await this.insertEnrollment(tx, {
        semesterEnrollmentId,
        programmeEnrollmentId: context.enrollment.id,
        studentId: context.enrollment.studentId,
        offeringId,
        selection: "ELECTIVE",
        actorUserId: actor.userId,
        reason: "Elective chosen by the student",
      });
      if (!created.ok) return created;
      return this.viewResult(tx.db, semesterEnrollmentId, today);
    });
  }

  /** Drops an elective before the add/drop deadline; afterwards only the Academic Admin can withdraw. */
  async dropElective(
    semesterEnrollmentId: string,
    courseEnrollmentId: string,
    actor: Actor,
  ): Promise<DomainResult<SemesterRegistration>> {
    const today = await this.settings.today();
    return this.guarded(async (tx) => {
      const context = await this.context(tx.db, semesterEnrollmentId);
      if (context === null) return notFound();
      const ce = schema.courseEnrollments;
      const [current] = await tx.db
        .select()
        .from(ce)
        .where(
          and(eq(ce.id, courseEnrollmentId), eq(ce.semesterEnrollmentId, semesterEnrollmentId)),
        )
        .for("update");
      if (current === undefined) return notFound();
      if (current.selection !== "ELECTIVE" || current.status !== "ENROLLED")
        return err(
          domainError(
            "ELECTIVE_NOT_AVAILABLE",
            "Only an elective you're enrolled on can be dropped. Ask the Academic Admin about others.",
          ),
        );
      if (!windowOpen(context.semester, today)) return closed();
      await this.end(tx, current, "DROPPED", actor.userId, "Elective dropped by the student");
      return this.viewResult(tx.db, semesterEnrollmentId, today);
    });
  }

  async roster(offeringId: string): Promise<RosterItem[]> {
    return this.rosterRows(this.db.read, eq(schema.courseEnrollments.courseOfferingId, offeringId));
  }

  /**
   * Registers a student by Matric Number (`selection = 'MANUAL'`), e.g. a retake of a failed
   * compulsory course (D-03); creates their semester enrollment if needed. A reason is required.
   */
  async registerManually(
    offeringId: string,
    input: { matricNumber: string; reason: string },
    actor: Actor,
  ): Promise<DomainResult<RosterItem>> {
    return this.guarded(async (tx) => {
      const pe = schema.programmeEnrollments;
      const [enrollment] = await tx.db
        .select()
        .from(pe)
        .where(
          and(
            eq(pe.matricNumber, input.matricNumber.trim().toUpperCase()),
            eq(pe.status, "ACTIVE"),
          ),
        );
      if (enrollment === undefined)
        return err(
          domainError("NOT_FOUND", "No active student has that Matric Number.", {
            fieldErrors: [{ path: "matricNumber", code: "not_found", message: "Not found." }],
          }),
        );
      const o = schema.courseOfferings;
      const [offering] = await tx.db
        .select({
          semesterId: o.semesterId,
          status: o.status,
          semesterStatus: schema.semesters.status,
        })
        .from(o)
        .innerJoin(schema.semesters, eq(schema.semesters.id, o.semesterId))
        .where(eq(o.id, offeringId));
      if (offering === undefined) return notFound();
      if (offering.status === "CANCELLED" || offering.semesterStatus === "CLOSED")
        return err(domainError("CONFLICT", "This offering isn't taking registrations."));

      const se = schema.semesterEnrollments;
      await tx.db
        .insert(se)
        .values({
          programmeEnrollmentId: enrollment.id,
          semesterId: offering.semesterId,
          levelNo: enrollment.currentLevel,
        })
        .onConflictDoNothing();
      const [semesterEnrollment] = await tx.db
        .select({ id: se.id, status: se.status })
        .from(se)
        .where(
          and(eq(se.programmeEnrollmentId, enrollment.id), eq(se.semesterId, offering.semesterId)),
        );
      if (semesterEnrollment?.status !== "REGISTERED")
        return err(domainError("CONFLICT", "The student isn't registered for this semester."));

      if (await this.alreadyEnrolled(tx.db, enrollment.studentId, offeringId))
        return alreadyEnrolled();
      const full = await this.lockAndCheckCapacity(tx.db, offeringId);
      if (full) return full;
      const created = await this.insertEnrollment(tx, {
        semesterEnrollmentId: semesterEnrollment.id,
        programmeEnrollmentId: enrollment.id,
        studentId: enrollment.studentId,
        offeringId,
        selection: "MANUAL",
        actorUserId: actor.userId,
        reason: input.reason,
      });
      if (!created.ok) return created;
      await this.audit.record(tx.db, actor, {
        action: "enrollment.course-enrollment.registered",
        resourceType: "course-enrollment",
        resourceId: created.value,
        metadata: { matricNumber: enrollment.matricNumber, offeringId, reason: input.reason },
      });
      return this.rosterItem(tx.db, created.value);
    });
  }

  /** Withdraws an enrolled student from a course (after the deadline, or a compulsory course). */
  async withdraw(
    courseEnrollmentId: string,
    reason: string,
    actor: Actor,
  ): Promise<DomainResult<RosterItem>> {
    return this.guarded(async (tx) => {
      const ce = schema.courseEnrollments;
      const [current] = await tx.db
        .select()
        .from(ce)
        .where(eq(ce.id, courseEnrollmentId))
        .for("update");
      if (current === undefined) return notFound();
      if (current.status !== "ENROLLED")
        return err(domainError("CONFLICT", "Only an enrolled course can be withdrawn from."));
      await this.end(tx, current, "WITHDRAWN", actor.userId, reason);
      await this.audit.record(tx.db, actor, {
        action: "enrollment.course-enrollment.withdrawn",
        resourceType: "course-enrollment",
        resourceId: courseEnrollmentId,
        metadata: { reason },
      });
      return this.rosterItem(tx.db, courseEnrollmentId);
    });
  }

  /** Who owns a semester or course enrollment, for authorization (§7.2). */
  async ownerOfSemesterEnrollment(id: string): Promise<string | null> {
    const [row] = await this.db.read
      .select({ userId: schema.students.userId })
      .from(schema.semesterEnrollments)
      .innerJoin(
        schema.programmeEnrollments,
        eq(schema.programmeEnrollments.id, schema.semesterEnrollments.programmeEnrollmentId),
      )
      .innerJoin(schema.students, eq(schema.students.id, schema.programmeEnrollments.studentId))
      .where(eq(schema.semesterEnrollments.id, id));
    return row?.userId ?? null;
  }

  async courseEnrollmentContext(
    id: string,
  ): Promise<{ ownerUserId: string; offeringId: string } | null> {
    const ce = schema.courseEnrollments;
    const [row] = await this.db.read
      .select({ userId: schema.students.userId, offeringId: ce.courseOfferingId })
      .from(ce)
      .innerJoin(schema.students, eq(schema.students.id, ce.studentId))
      .where(eq(ce.id, id));
    return row === undefined ? null : { ownerUserId: row.userId, offeringId: row.offeringId };
  }

  private async context(db: Database, semesterEnrollmentId: string) {
    const se = schema.semesterEnrollments;
    const s = schema.semesters;
    const [row] = await db
      .select({
        se,
        enrollment: schema.programmeEnrollments,
        semester: {
          id: s.id,
          name: s.name,
          sequence: s.sequence,
          status: s.status,
          addDropDeadlineOn: s.addDropDeadlineOn,
          sessionName: schema.academicSessions.name,
        },
      })
      .from(se)
      .innerJoin(
        schema.programmeEnrollments,
        eq(schema.programmeEnrollments.id, se.programmeEnrollmentId),
      )
      .innerJoin(s, eq(s.id, se.semesterId))
      .innerJoin(schema.academicSessions, eq(schema.academicSessions.id, s.academicSessionId))
      .where(eq(se.id, semesterEnrollmentId));
    return row ?? null;
  }

  /** ELECTIVE placements for the enrollment's Level and semester with a teachable offering. */
  private async availableElectives(
    db: Database,
    context: NonNullable<Awaited<ReturnType<CourseEnrollmentsService["context"]>>>,
  ) {
    const cc = schema.curriculumCourses;
    const o = schema.courseOfferings;
    const c = schema.courses;
    return db
      .select({
        offeringId: o.id,
        courseCode: c.code,
        title: sql<string>`coalesce(${o.titleOverride}, ${c.title})`,
        credits: sql<string>`coalesce(${cc.creditOverride}, ${c.credits})::text`,
        capacity: o.capacity,
      })
      .from(cc)
      .innerJoin(c, eq(c.id, cc.courseId))
      .innerJoin(o, and(eq(o.courseId, cc.courseId), eq(o.semesterId, context.semester.id)))
      .where(
        and(
          eq(cc.curriculumId, context.enrollment.curriculumId),
          eq(cc.levelNo, context.se.levelNo),
          eq(cc.semesterNo, context.semester.sequence),
          eq(cc.courseType, "ELECTIVE"),
          inArray(o.status, TEACHABLE),
        ),
      )
      .orderBy(asc(c.code), asc(o.sectionCode));
  }

  /** A live (ENROLLED or COMPLETED) enrollment of the student on the offering already exists. */
  private async alreadyEnrolled(db: Database, studentId: string, offeringId: string) {
    const ce = schema.courseEnrollments;
    const [row] = await db
      .select({ id: ce.id })
      .from(ce)
      .where(
        and(
          eq(ce.studentId, studentId),
          eq(ce.courseOfferingId, offeringId),
          inArray(ce.status, ["ENROLLED", "COMPLETED"]),
        ),
      );
    return row !== undefined;
  }

  /** Locks the offering (§9.3 capacity) and refuses when it's full. */
  private async lockAndCheckCapacity(db: Database, offeringId: string) {
    const o = schema.courseOfferings;
    const [offering] = await db
      .select({ capacity: o.capacity })
      .from(o)
      .where(eq(o.id, offeringId))
      .for("update");
    if (offering === undefined) return notFound();
    if (offering.capacity === null) return null;
    const ce = schema.courseEnrollments;
    const [enrolled] = await db
      .select({ n: count() })
      .from(ce)
      .where(and(eq(ce.courseOfferingId, offeringId), eq(ce.status, "ENROLLED")));
    return (enrolled?.n ?? 0) >= offering.capacity
      ? err(domainError("OFFERING_FULL", "This course is full."))
      : null;
  }

  private async insertEnrollment(
    tx: Tx,
    input: {
      semesterEnrollmentId: string;
      programmeEnrollmentId: string;
      studentId: string;
      offeringId: string;
      selection: "ELECTIVE" | "MANUAL";
      actorUserId: string;
      reason: string;
    },
  ): Promise<DomainResult<string>> {
    const now = this.clock.now();
    const [created] = await tx.db
      .insert(schema.courseEnrollments)
      .values({
        semesterEnrollmentId: input.semesterEnrollmentId,
        programmeEnrollmentId: input.programmeEnrollmentId,
        courseOfferingId: input.offeringId,
        studentId: input.studentId,
        selection: input.selection,
        enrolledAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: schema.courseEnrollments.id });
    if (created === undefined)
      return err(
        domainError("ALREADY_ENROLLED", "The student is already registered for this course."),
      );
    await tx.db.insert(schema.courseEnrollmentEvents).values({
      courseEnrollmentId: created.id,
      fromStatus: null,
      toStatus: "ENROLLED",
      actorUserId: input.actorUserId,
      reason: input.reason,
      createdAt: now,
    });
    await tx.boss.publish(
      "course.enrollment.activated",
      {
        courseEnrollmentId: created.id,
        courseOfferingId: input.offeringId,
        studentId: input.studentId,
      },
      { occurredAt: now, actorUserId: input.actorUserId },
    );
    return ok(created.id);
  }

  /** DROPPED or WITHDRAWN; attendance and grades are kept (§9.3). */
  private async end(
    tx: Tx,
    current: CourseEnrollmentRow,
    to: "DROPPED" | "WITHDRAWN",
    actorUserId: string,
    reason: string,
  ): Promise<void> {
    const now = this.clock.now();
    const ce = schema.courseEnrollments;
    await tx.db
      .update(ce)
      .set({ status: to, droppedAt: now, updatedAt: now, version: sql`${ce.version} + 1` })
      .where(eq(ce.id, current.id));
    await tx.db.insert(schema.courseEnrollmentEvents).values({
      courseEnrollmentId: current.id,
      fromStatus: current.status,
      toStatus: to,
      actorUserId,
      reason,
      createdAt: now,
    });
    await tx.boss.publish(
      "course.enrollment.ended",
      {
        courseEnrollmentId: current.id,
        courseOfferingId: current.courseOfferingId,
        studentId: current.studentId,
        status: to,
      },
      { occurredAt: now, actorUserId },
    );
  }

  private async viewResult(
    db: Database,
    semesterEnrollmentId: string,
    today: string,
  ): Promise<DomainResult<SemesterRegistration>> {
    const view = await this.view(db, semesterEnrollmentId, today);
    return view === null ? notFound() : ok(view);
  }

  private async view(
    db: Database,
    semesterEnrollmentId: string,
    today: string,
  ): Promise<SemesterRegistration | null> {
    const context = await this.context(db, semesterEnrollmentId);
    if (context === null) return null;
    const ce = schema.courseEnrollments;
    const o = schema.courseOfferings;
    const c = schema.courses;
    const courses = await db
      .select({
        ce,
        courseCode: c.code,
        title: sql<string>`coalesce(${o.titleOverride}, ${c.title})`,
        credits: sql<string>`${c.credits}::text`,
      })
      .from(ce)
      .innerJoin(o, eq(o.id, ce.courseOfferingId))
      .innerJoin(c, eq(c.id, o.courseId))
      .where(eq(ce.semesterEnrollmentId, semesterEnrollmentId))
      .orderBy(asc(c.code));
    const electives = await this.availableElectives(db, context);
    const counts =
      electives.length === 0
        ? []
        : await db
            .select({ offeringId: ce.courseOfferingId, n: count() })
            .from(ce)
            .where(
              and(
                inArray(
                  ce.courseOfferingId,
                  electives.map((e) => e.offeringId),
                ),
                eq(ce.status, "ENROLLED"),
              ),
            )
            .groupBy(ce.courseOfferingId);
    return {
      semesterEnrollmentId,
      levelNo: context.se.levelNo,
      semester: {
        id: context.semester.id,
        name: context.semester.name,
        sessionName: context.semester.sessionName,
        status: context.semester.status as SemesterRegistration["semester"]["status"],
        addDropDeadlineOn: context.semester.addDropDeadlineOn,
      },
      windowOpen: windowOpen(context.semester, today),
      courses: courses.map((r) => ({
        courseEnrollmentId: r.ce.id,
        offeringId: r.ce.courseOfferingId,
        courseCode: r.courseCode,
        title: r.title,
        credits: r.credits,
        selection: r.ce.selection as SemesterRegistration["courses"][number]["selection"],
        status: r.ce.status as SemesterRegistration["courses"][number]["status"],
      })),
      electives: electives.map((e) => {
        const enrolled = counts.find((x) => x.offeringId === e.offeringId)?.n ?? 0;
        const mine = courses.find(
          (r) => r.ce.courseOfferingId === e.offeringId && r.ce.status === "ENROLLED",
        );
        return {
          ...e,
          enrolled,
          full: e.capacity !== null && enrolled >= e.capacity,
          courseEnrollmentId: mine?.ce.id ?? null,
        };
      }),
    };
  }

  private async rosterRows(db: Database, where: ReturnType<typeof eq>): Promise<RosterItem[]> {
    const ce = schema.courseEnrollments;
    const pe = schema.programmeEnrollments;
    const s = schema.students;
    const rows = await db
      .select({
        ce,
        given: s.givenName,
        family: s.familyName,
        matric: pe.matricNumber,
        programmeCode: schema.programmes.code,
        levelNo: schema.semesterEnrollments.levelNo,
      })
      .from(ce)
      .innerJoin(s, eq(s.id, ce.studentId))
      .innerJoin(pe, eq(pe.id, ce.programmeEnrollmentId))
      .innerJoin(schema.programmes, eq(schema.programmes.id, pe.programmeId))
      .innerJoin(
        schema.semesterEnrollments,
        eq(schema.semesterEnrollments.id, ce.semesterEnrollmentId),
      )
      .where(where)
      .orderBy(asc(s.familyName), asc(s.givenName));
    return rows.map((r) => ({
      courseEnrollmentId: r.ce.id,
      studentName: `${r.given} ${r.family}`,
      matricNumber: r.matric,
      programmeCode: r.programmeCode,
      levelNo: r.levelNo,
      selection: r.ce.selection as RosterItem["selection"],
      status: r.ce.status as RosterItem["status"],
      enrolledAt: r.ce.enrolledAt.toISOString(),
    }));
  }

  private async rosterItem(
    db: Database,
    courseEnrollmentId: string,
  ): Promise<DomainResult<RosterItem>> {
    const [item] = await this.rosterRows(db, eq(schema.courseEnrollments.id, courseEnrollmentId));
    return item === undefined ? notFound() : ok(item);
  }

  private async guarded<T>(fn: (tx: Tx) => Promise<DomainResult<T>>): Promise<DomainResult<T>> {
    try {
      return await this.db.withTxResult(fn);
    } catch (error) {
      if (pgError(error)?.code === PG.UNIQUE_VIOLATION)
        return err(
          domainError("ALREADY_ENROLLED", "The student is already registered for this course."),
        );
      throw error;
    }
  }
}

/** Electives can change while registration or teaching is on, up to the add/drop deadline (§9.3). */
function windowOpen(
  semester: { status: string; addDropDeadlineOn: string | null },
  today: string,
): boolean {
  return (
    OPEN.includes(semester.status) &&
    (semester.addDropDeadlineOn === null || today <= semester.addDropDeadlineOn)
  );
}

const closed = () =>
  err(
    domainError(
      "REGISTRATION_CLOSED",
      "The add/drop deadline has passed. Ask the Academic Admin if you need to change your courses.",
    ),
  );

const alreadyEnrolled = () =>
  err(domainError("ALREADY_ENROLLED", "Already registered for this course."));
