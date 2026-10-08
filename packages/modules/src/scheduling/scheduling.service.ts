import type { ScheduleConflict, ScheduleWarning } from "@glim/contracts";
import { Db, PG, pgError, schema, withSavepoint, type Database } from "@glim/db";
import { CLOCK, domainError, type Clock, type DomainError } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, ne, sql } from "drizzle-orm";

/** A Class Meeting's place in time, for booking and conflict checks. */
export interface MeetingTime {
  meetingId?: string;
  offeringId: string;
  start: Date;
  end: Date;
}

const SAMPLE_SIZE = 5;

/** `[start, end)` as a Postgres range, the same shape the exclusion constraints compare. */
const range = (start: Date, end: Date) =>
  sql`tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz)`;

/**
 * Schedule conflict rules (owner: scheduling, TRD §9.5). Lecturer and Room double-booking are
 * blocking and enforced by exclusion constraints; the queries here only find the meetings in the
 * way, so the error can list them. A student clash is a warning.
 */
@Injectable()
export class SchedulingService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Books every active Lecturer of the offering for the meeting (`meeting_lecturer_slots`). With
   * an override (Academic Admin, with a reason) the slots don't count towards `no_lecturer_overlap`.
   * Throws the database's exclusion violation if a Lecturer is busy; callers map it.
   */
  async bookLecturers(
    db: Database,
    meeting: MeetingTime & { meetingId: string },
    override: { reason: string } | null,
  ): Promise<void> {
    const lecturerIds = await this.activeLecturers(db, meeting.offeringId);
    if (lecturerIds.length === 0) return;
    await db.insert(schema.meetingLecturerSlots).values(
      lecturerIds.map((lecturerId) => ({
        classMeetingId: meeting.meetingId,
        lecturerId,
        during: range(meeting.start, meeting.end),
        override: override !== null,
        overrideReason: override?.reason ?? null,
      })),
    );
  }

  /** Meetings that would double-book one of the offering's Lecturers at this time. */
  async lecturerConflicts(
    meeting: MeetingTime,
    db: Database = this.db.read,
  ): Promise<ScheduleConflict[]> {
    const lecturerIds = await this.activeLecturers(db, meeting.offeringId);
    if (lecturerIds.length === 0) return [];
    const s = schema.meetingLecturerSlots;
    const m = schema.classMeetings;
    const rows = await db
      .selectDistinct({
        id: m.id,
        title: m.title,
        start: m.scheduledStart,
        end: m.scheduledEnd,
      })
      .from(s)
      .innerJoin(m, eq(m.id, s.classMeetingId))
      .where(
        and(
          eq(s.override, false),
          sql`${s.lecturerId} IN (${sql.join(
            lecturerIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
          sql`${s.during} && ${range(meeting.start, meeting.end)}`,
          ne(m.state, "CANCELLED"),
          meeting.meetingId === undefined ? undefined : ne(m.id, meeting.meetingId),
        ),
      )
      .orderBy(m.scheduledStart);
    return rows.map(toConflict);
  }

  /** Meetings already in the Room at this time. */
  async roomConflicts(
    roomId: string,
    meeting: Omit<MeetingTime, "offeringId">,
    db: Database = this.db.read,
  ): Promise<ScheduleConflict[]> {
    const m = schema.classMeetings;
    const rows = await db
      .select({ id: m.id, title: m.title, start: m.scheduledStart, end: m.scheduledEnd })
      .from(m)
      .where(
        and(
          eq(m.roomId, roomId),
          ne(m.state, "CANCELLED"),
          sql`tstzrange(${m.scheduledStart}, ${m.scheduledEnd}) && ${range(meeting.start, meeting.end)}`,
          meeting.meetingId === undefined ? undefined : ne(m.id, meeting.meetingId),
        ),
      )
      .orderBy(m.scheduledStart);
    return rows.map(toConflict);
  }

  /**
   * Students enrolled on the offering who have another Class Meeting at this time (a warning,
   * not a block, §9.5). Null when there is no clash.
   */
  async studentClash(
    meeting: MeetingTime,
    db: Database = this.db.read,
  ): Promise<ScheduleWarning | null> {
    const exclude = meeting.meetingId ?? "00000000-0000-0000-0000-000000000000";
    const { rows } = await db.execute<{ students: string; meeting_ids: string[] | null }>(sql`
      SELECT count(DISTINCT mine.student_id)::text AS students,
             (array_agg(DISTINCT cm.id))[1:${SAMPLE_SIZE}] AS meeting_ids
        FROM course_enrollments mine
        JOIN course_enrollments other
          ON other.student_id = mine.student_id
         AND other.status = 'ENROLLED'
         AND other.course_offering_id <> mine.course_offering_id
        JOIN class_meetings cm ON cm.course_offering_id = other.course_offering_id
       WHERE mine.course_offering_id = ${meeting.offeringId}
         AND mine.status = 'ENROLLED'
         AND cm.state <> 'CANCELLED'
         AND cm.id <> ${exclude}::uuid
         AND tstzrange(cm.scheduled_start, cm.scheduled_end) && ${range(meeting.start, meeting.end)}`);
    const count = Number(rows[0]?.students ?? 0);
    if (count === 0) return null;
    return {
      code: "STUDENT_SCHEDULE_CLASH",
      count,
      sampleMeetingIds: rows[0]?.meeting_ids ?? [],
    };
  }

  /**
   * §9.4: a Lecturer joining an offering is booked into its future Class Meetings, in the
   * assignment's transaction. If they're busy at one of those times the assignment is refused
   * with the meetings in the way.
   */
  async lecturerAdded(
    db: Database,
    change: { offeringId: string; lecturerId: string },
  ): Promise<DomainError | null> {
    const m = schema.classMeetings;
    const s = schema.meetingLecturerSlots;
    // Meetings they're already booked into (e.g. one under way) are skipped. Not ON CONFLICT DO
    // NOTHING: that would also swallow the overlap the exclusion constraint exists to catch.
    const future = await db
      .select({ id: m.id, start: m.scheduledStart, end: m.scheduledEnd })
      .from(m)
      .where(
        and(
          eq(m.courseOfferingId, change.offeringId),
          ne(m.state, "CANCELLED"),
          gt(m.scheduledEnd, this.clock.now()),
          sql`NOT EXISTS (SELECT 1 FROM ${s} WHERE ${s.classMeetingId} = ${m.id} AND ${s.lecturerId} = ${change.lecturerId})`,
        ),
      );
    if (future.length === 0) return null;
    try {
      await withSavepoint(db, () =>
        db.insert(schema.meetingLecturerSlots).values(
          future.map((meeting) => ({
            classMeetingId: meeting.id,
            lecturerId: change.lecturerId,
            during: range(meeting.start, meeting.end),
          })),
        ),
      );
      return null;
    } catch (error) {
      if (pgError(error)?.code !== PG.EXCLUSION_VIOLATION) throw error;
      const conflicts: ScheduleConflict[] = [];
      for (const meeting of future)
        conflicts.push(...(await this.slotConflicts(db, change.lecturerId, meeting)));
      return domainError(
        "LECTURER_SCHEDULE_CONFLICT",
        "This Lecturer already has a Class Meeting at the time of one of this offering's meetings.",
        { conflicts: dedupe(conflicts) },
      );
    }
  }

  /** §9.4: a Lecturer leaving an offering is freed from its future Class Meetings. */
  async lecturerEnded(
    db: Database,
    change: { offeringId: string; lecturerId: string },
  ): Promise<void> {
    const s = schema.meetingLecturerSlots;
    const m = schema.classMeetings;
    await db.delete(s).where(
      and(
        eq(s.lecturerId, change.lecturerId),
        sql`${s.classMeetingId} IN (${db
          .select({ id: m.id })
          .from(m)
          .where(
            and(eq(m.courseOfferingId, change.offeringId), gt(m.scheduledStart, this.clock.now())),
          )})`,
      ),
    );
  }

  private async slotConflicts(
    db: Database,
    lecturerId: string,
    meeting: { start: Date; end: Date },
  ): Promise<ScheduleConflict[]> {
    const s = schema.meetingLecturerSlots;
    const m = schema.classMeetings;
    const rows = await db
      .select({ id: m.id, title: m.title, start: m.scheduledStart, end: m.scheduledEnd })
      .from(s)
      .innerJoin(m, eq(m.id, s.classMeetingId))
      .where(
        and(
          eq(s.lecturerId, lecturerId),
          eq(s.override, false),
          ne(m.state, "CANCELLED"),
          sql`${s.during} && ${range(meeting.start, meeting.end)}`,
        ),
      );
    return rows.map(toConflict);
  }

  private async activeLecturers(db: Database, offeringId: string): Promise<string[]> {
    const la = schema.lecturerAssignments;
    const l = schema.lecturers;
    const rows = await db
      .select({ id: la.lecturerId })
      .from(la)
      .innerJoin(l, eq(l.id, la.lecturerId))
      .where(
        and(eq(la.courseOfferingId, offeringId), eq(la.status, "ACTIVE"), eq(l.status, "ACTIVE")),
      );
    return rows.map((r) => r.id);
  }
}

function toConflict(row: { id: string; title: string; start: Date; end: Date }): ScheduleConflict {
  return {
    meetingId: row.id,
    title: row.title,
    scheduledStart: row.start.toISOString(),
    scheduledEnd: row.end.toISOString(),
  };
}

function dedupe(conflicts: ScheduleConflict[]): ScheduleConflict[] {
  return [...new Map(conflicts.map((c) => [c.meetingId, c])).values()];
}
