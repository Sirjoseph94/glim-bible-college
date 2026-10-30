import type { MakeupExam } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { NotificationsService } from "@glim/modules/notifications";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { GradesService } from "./grades.service";
import { studentLocked } from "./gradebook-locks";

type Actor = AuditActor & { userId: string };

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/**
 * Makeup exams (owner: assessment, GLOSSARY "Makeup Exam", ADR-0005): the Lecturer gives a
 * student who missed the offering's exam a later date, with a reason. Until the student has an
 * exam grade, finalizing the course leaves their result out; an online exam is open to them on
 * that day. Every change is audited and the student is told.
 */
@Injectable()
export class MakeupsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(GradesService) private readonly grades: GradesService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async list(offeringId: string): Promise<MakeupExam[]> {
    return this.rows(this.db.read, eq(schema.examMakeups.courseOfferingId, offeringId));
  }

  /**
   * Sets or moves a student's makeup date: on or after the offering's exam date, for a student on
   * the course whose result isn't finalized yet (reopen it first otherwise).
   */
  set(
    offeringId: string,
    studentId: string,
    input: { makeupOn: string; reason: string },
    actor: Actor,
  ): Promise<DomainResult<MakeupExam>> {
    return this.db.withTxResult(async (tx) => {
      const { db } = tx;
      const o = schema.courseOfferings;
      const [offering] = await db
        .select({
          examOn: o.examOn,
          status: o.status,
          courseCode: schema.courses.code,
          courseTitle: schema.courses.title,
        })
        .from(o)
        .innerJoin(schema.courses, eq(schema.courses.id, o.courseId))
        .where(eq(o.id, offeringId));
      if (offering === undefined) return notFound();
      if (offering.status === "CANCELLED")
        return err(domainError("CONFLICT", "This offering is cancelled."));
      if (!(await this.grades.onCourse(db, offeringId, studentId))) return notFound();
      if (input.makeupOn < offering.examOn)
        return err(
          domainError("VALIDATION_FAILED", "A makeup exam can't be before the exam date.", {
            fieldErrors: [
              {
                path: "body.makeupOn",
                code: "too_early",
                message: `Choose ${offering.examOn} or later.`,
              },
            ],
          }),
        );
      if (await studentLocked(db, offeringId, studentId))
        return err(
          domainError(
            "GRADEBOOK_LOCKED",
            "This student's result is finalized. Ask the Registrar to reopen it first.",
          ),
        );
      const now = this.clock.now();
      const m = schema.examMakeups;
      const [before] = await db
        .select({ makeupOn: m.makeupOn })
        .from(m)
        .where(and(eq(m.courseOfferingId, offeringId), eq(m.studentId, studentId)));
      await db
        .insert(m)
        .values({
          courseOfferingId: offeringId,
          studentId,
          makeupOn: input.makeupOn,
          reason: input.reason,
          setBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [m.courseOfferingId, m.studentId],
          set: {
            makeupOn: input.makeupOn,
            reason: input.reason,
            setBy: actor.userId,
            updatedAt: now,
            version: sql`${m.version} + 1`,
          },
        });
      await this.audit.record(db, actor, {
        action: "assessment.makeup-exam.set",
        resourceType: "course-offering",
        resourceId: offeringId,
        metadata: {
          studentId,
          makeupOn: input.makeupOn,
          from: before?.makeupOn ?? null,
          reason: input.reason,
        },
      });
      const [student] = await db
        .select({ userId: schema.students.userId })
        .from(schema.students)
        .where(eq(schema.students.id, studentId));
      if (student !== undefined && before?.makeupOn !== input.makeupOn)
        await this.notifications.notify(tx, {
          userId: student.userId,
          kind: "assessment.makeup-exam",
          title: `${offering.courseCode}: your makeup exam is on ${input.makeupOn}`,
          data: {
            offeringId,
            courseCode: offering.courseCode,
            courseTitle: offering.courseTitle,
            makeupOn: input.makeupOn,
          },
          email: true,
          dedupeKey: `makeup-exam:${offeringId}:${studentId}:${input.makeupOn}`,
        });
      const [row] = await this.rows(
        db,
        and(eq(m.courseOfferingId, offeringId), eq(m.studentId, studentId)),
      );
      if (row === undefined) throw new Error("makeup exam vanished");
      return ok(row);
    });
  }

  /**
   * Removes a student's makeup date; the next finalization includes them again. Not once their
   * result is finalized (reopen it first).
   */
  remove(offeringId: string, studentId: string, actor: Actor): Promise<DomainResult<null>> {
    return this.db.withTxResult(async ({ db }) => {
      if (await studentLocked(db, offeringId, studentId))
        return err(
          domainError(
            "GRADEBOOK_LOCKED",
            "This student's result is finalized. Ask the Registrar to reopen it first.",
          ),
        );
      const m = schema.examMakeups;
      const [removed] = await db
        .delete(m)
        .where(and(eq(m.courseOfferingId, offeringId), eq(m.studentId, studentId)))
        .returning({ makeupOn: m.makeupOn });
      if (removed === undefined) return notFound();
      await this.audit.record(db, actor, {
        action: "assessment.makeup-exam.removed",
        resourceType: "course-offering",
        resourceId: offeringId,
        metadata: { studentId, makeupOn: removed.makeupOn },
      });
      return ok(null);
    });
  }

  private async rows(db: Database, where: ReturnType<typeof and>): Promise<MakeupExam[]> {
    const m = schema.examMakeups;
    const st = schema.students;
    const ce = schema.courseEnrollments;
    const pe = schema.programmeEnrollments;
    const rows = await db
      .selectDistinct({
        studentId: m.studentId,
        given: st.givenName,
        family: st.familyName,
        matricNumber: pe.matricNumber,
        makeupOn: m.makeupOn,
        reason: m.reason,
        setAt: m.updatedAt,
      })
      .from(m)
      .innerJoin(st, eq(st.id, m.studentId))
      .leftJoin(
        ce,
        and(eq(ce.studentId, m.studentId), eq(ce.courseOfferingId, m.courseOfferingId)),
      )
      .leftJoin(pe, eq(pe.id, ce.programmeEnrollmentId))
      .where(where)
      .orderBy(asc(m.makeupOn), asc(st.familyName), asc(st.givenName));
    return rows.map((r) => ({
      studentId: r.studentId,
      studentName: `${r.given} ${r.family}`,
      matricNumber: r.matricNumber,
      makeupOn: r.makeupOn,
      reason: r.reason,
      setAt: r.setAt.toISOString(),
    }));
  }
}
