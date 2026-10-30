import type { RosterItem } from "@glim/contracts";
import { Db, PG, pgError, schema, type Database, type Tx } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

type Actor = AuditActor & { userId: string };
type CourseEnrollmentRow = typeof schema.courseEnrollments.$inferSelect;

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/**
 * Course enrollments beyond the cohort's own (owner: enrollment, TRD §9.3, ADR-0005): the Academic
 * Admin registers students manually (a retake, a course a late joiner missed, a transfer) and
 * withdraws them, with reasons. Capacity is checked under a row lock on the offering. Every
 * change writes `course_enrollment_events`.
 */
@Injectable()
export class CourseEnrollmentsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async roster(offeringId: string): Promise<RosterItem[]> {
    return this.rosterRows(this.db.read, eq(schema.courseEnrollments.courseOfferingId, offeringId));
  }

  /**
   * Registers a student by Matric Number (`selection = 'MANUAL'`) into any open offering, whatever
   * its cohort: a Retake of a failed course, a course a late joiner missed, or a transfer. A reason
   * is required.
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
        .select({ status: o.status })
        .from(o)
        .where(eq(o.id, offeringId));
      if (offering === undefined) return notFound();
      if (offering.status === "CANCELLED" || offering.status === "COMPLETED")
        return err(domainError("CONFLICT", "This offering isn't taking registrations."));

      if (await this.alreadyEnrolled(tx.db, enrollment.studentId, offeringId))
        return alreadyEnrolled();
      const full = await this.lockAndCheckCapacity(tx.db, offeringId);
      if (full) return full;
      const created = await this.insertEnrollment(tx, {
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

  /** Withdraws an enrolled student from a course; attendance and grades are kept. */
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

  /**
   * An offering completes (the day after it ends, ADR-0005): its ENROLLED course enrollments
   * become COMPLETED, with their history, inside the lifecycle job's transaction. COMPLETED keeps
   * read-only access to the offering while the programme enrollment is active (C-25,
   * `v_offering_access`).
   */
  async completeForOffering(db: Database, offeringId: string, now: Date): Promise<void> {
    const ce = schema.courseEnrollments;
    const completed = await db
      .update(ce)
      .set({ status: "COMPLETED", updatedAt: now, version: sql`${ce.version} + 1` })
      .where(and(eq(ce.status, "ENROLLED"), eq(ce.courseOfferingId, offeringId)))
      .returning({ id: ce.id });
    if (completed.length === 0) return;
    await db.insert(schema.courseEnrollmentEvents).values(
      completed.map((row) => ({
        courseEnrollmentId: row.id,
        fromStatus: "ENROLLED",
        toStatus: "COMPLETED",
        reason: "Offering completed",
        createdAt: now,
      })),
    );
  }

  /** Who owns a course enrollment, and its offering, for authorization (§7.2). */
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
      programmeEnrollmentId: string;
      studentId: string;
      offeringId: string;
      selection: "MANUAL";
      actorUserId: string;
      reason: string;
    },
  ): Promise<DomainResult<string>> {
    const now = this.clock.now();
    const [created] = await tx.db
      .insert(schema.courseEnrollments)
      .values({
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

  /** WITHDRAWN; attendance and grades are kept (§9.3). */
  private async end(
    tx: Tx,
    current: CourseEnrollmentRow,
    to: "WITHDRAWN",
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
        cohortCode: schema.cohorts.code,
      })
      .from(ce)
      .innerJoin(s, eq(s.id, ce.studentId))
      .innerJoin(pe, eq(pe.id, ce.programmeEnrollmentId))
      .innerJoin(schema.programmes, eq(schema.programmes.id, pe.programmeId))
      .innerJoin(schema.cohorts, eq(schema.cohorts.id, pe.cohortId))
      .where(where)
      .orderBy(asc(s.familyName), asc(s.givenName));
    return rows.map((r) => ({
      courseEnrollmentId: r.ce.id,
      studentName: `${r.given} ${r.family}`,
      matricNumber: r.matric,
      programmeCode: r.programmeCode,
      cohortCode: r.cohortCode,
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

const alreadyEnrolled = () =>
  err(domainError("ALREADY_ENROLLED", "Already registered for this course."));
