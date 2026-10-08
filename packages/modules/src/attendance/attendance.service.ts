import { attendancePolicy, type MeetingAttendance, type MyAttendance } from "@glim/contracts";
import { Db, schema, type Database, type TxQueue } from "@glim/db";
import { MeetingLifecycleService } from "@glim/modules/class-meeting";
import { CLOCK, type Clock } from "@glim/shared";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { computeAttendance, type AttendanceResult, type RollCallInput } from "./domain/compute";

type MeetingRow = typeof schema.classMeetings.$inferSelect;
type RecordRow = typeof schema.attendanceRecords.$inferSelect;

const DAY = 86_400_000;
/**
 * v1 spec: with no conference data the short-conference review flag isn't used, so a meeting
 * computed from roll call alone is FINAL rather than REVIEW_REQUIRED.
 */
const SHORT_CONFERENCE_REVIEW: boolean = false;

function snapshot(meeting: MeetingRow) {
  const s = meeting.policySnapshot as {
    attendance?: { version?: number; config?: unknown };
  } | null;
  return {
    version: s?.attendance?.version ?? 0,
    policy: attendancePolicy.parse(s?.attendance?.config ?? {}),
  };
}

/** The fields recompute owns; overrides and `status` are never among them (§12.5). */
const COMPUTED = [
  "computedStatus",
  "attendanceMode",
  "attendedSeconds",
  "effectiveSeconds",
  "ratioBp",
  "late",
  "joinCount",
] as const;

const sameTime = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

function unchanged(row: RecordRow, result: AttendanceResult): boolean {
  return (
    COMPUTED.every((k) => row[k] === result[k]) &&
    sameTime(row.firstJoinAt, result.firstJoinAt) &&
    sameTime(row.lastLeaveAt, result.lastLeaveAt)
  );
}

/**
 * Attendance records (owner: attendance, TRD §12.5–12.6): recomputed from the evidence under an
 * advisory lock per meeting, idempotently, until a week after finalization; finalized a short
 * delay after the class ends.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(MeetingLifecycleService) private readonly lifecycle: MeetingLifecycleService,
  ) {}

  /** The `attendance.recompute` job. Returns how many records changed, or why it didn't run. */
  recompute(meetingId: string): Promise<number | "LOCKED" | "SKIPPED"> {
    return this.db.withTx(async ({ db }) => {
      const meeting = await this.lock(db, meetingId);
      if (meeting === null || meeting.state === "CANCELLED" || meeting.state === "NO_SHOW")
        return "SKIPPED";
      if (this.locked(meeting)) return "LOCKED";
      const { changed } = await this.compute(db, meeting);
      if (meeting.attendanceState === "PENDING")
        await this.lifecycle.recordAttendanceState(db, meetingId, {
          attendanceState: "PROVISIONAL",
        });
      return changed;
    });
  }

  /**
   * Queues finalization once a class has ended, after `finalizeDelayMinutes` so that a restart
   * just after an accidental End still counts (§12.6).
   */
  async queueFinalize(boss: TxQueue, meetingId: string): Promise<void> {
    const m = schema.classMeetings;
    const [meeting] = await this.db.read.select().from(m).where(eq(m.id, meetingId));
    if (meeting === undefined) return;
    const delay = snapshot(meeting).policy.finalizeDelayMinutes * 60;
    await boss.send("class-meeting.finalize", { meetingId }, { startAfter: delay });
  }

  /**
   * The `class-meeting.finalize` job: computes the records one last time, marks the meeting
   * FINAL with `finalized_at` and emits `attendance.finalized`. Skips a meeting that has gone
   * live again, or is already finalized.
   */
  finalize(meetingId: string): Promise<"FINAL" | "REVIEW_REQUIRED" | "SKIPPED"> {
    return this.db.withTx(async ({ db, boss }) => {
      const meeting = await this.lock(db, meetingId);
      if (meeting === null || meeting.state !== "ENDED" || meeting.finalizedAt !== null)
        return "SKIPPED";
      const { shortConference } = await this.compute(db, meeting);
      const state = SHORT_CONFERENCE_REVIEW && shortConference ? "REVIEW_REQUIRED" : "FINAL";
      const now = this.clock.now();
      await this.lifecycle.recordAttendanceState(db, meetingId, {
        attendanceState: state,
        finalizedAt: now,
      });
      await boss.publish(
        "attendance.finalized",
        { meetingId, offeringId: meeting.courseOfferingId, attendanceState: state },
        { occurredAt: now, actorUserId: null },
      );
      this.logger.info({ meetingId, state }, "attendance finalized");
      return state;
    });
  }

  /** A meeting's records, for its Lecturers and staff. */
  async forMeeting(meetingId: string): Promise<MeetingAttendance | null> {
    const m = schema.classMeetings;
    const [meeting] = await this.db.read.select().from(m).where(eq(m.id, meetingId));
    if (meeting === undefined) return null;
    const r = schema.attendanceRecords;
    const s = schema.students;
    const pe = schema.programmeEnrollments;
    const rows = await this.db.read
      .selectDistinctOn([s.familyName, s.givenName, r.studentId], {
        record: r,
        status: schema.attendanceStatus,
        givenName: s.givenName,
        familyName: s.familyName,
        matricNumber: pe.matricNumber,
      })
      .from(r)
      .innerJoin(s, eq(s.id, r.studentId))
      .innerJoin(
        schema.courseEnrollments,
        and(
          eq(schema.courseEnrollments.studentId, r.studentId),
          eq(schema.courseEnrollments.courseOfferingId, meeting.courseOfferingId),
        ),
      )
      .innerJoin(pe, eq(pe.id, schema.courseEnrollments.programmeEnrollmentId))
      .where(eq(r.classMeetingId, meetingId))
      .orderBy(asc(s.familyName), asc(s.givenName), asc(r.studentId));
    const lockedAt =
      meeting.finalizedAt === null
        ? null
        : new Date(meeting.finalizedAt.getTime() + snapshot(meeting).policy.lockAfterDays * DAY);
    return {
      meetingId,
      attendanceState: meeting.attendanceState as MeetingAttendance["attendanceState"],
      finalizedAt: meeting.finalizedAt?.toISOString() ?? null,
      lockedAt: lockedAt?.toISOString() ?? null,
      records: rows.map(({ record, status, givenName, familyName, matricNumber }) => ({
        studentId: record.studentId,
        name: `${givenName} ${familyName}`,
        matricNumber,
        status: status as MeetingAttendance["records"][number]["status"],
        computedStatus:
          record.computedStatus as MeetingAttendance["records"][number]["computedStatus"],
        overrideStatus:
          record.overrideStatus as MeetingAttendance["records"][number]["overrideStatus"],
        mode: record.attendanceMode as MeetingAttendance["records"][number]["mode"],
        late: record.late,
        ratioBp: record.ratioBp,
      })),
    };
  }

  /** The signed-in student's own records, per course (§12, student view). */
  async mine(userId: string): Promise<MyAttendance> {
    const r = schema.attendanceRecords;
    const m = schema.classMeetings;
    const s = schema.students;
    const rows = await this.db.read
      .select({
        meetingId: m.id,
        title: m.title,
        scheduledStart: m.scheduledStart,
        finalizedAt: m.finalizedAt,
        offeringId: m.courseOfferingId,
        courseCode: schema.courses.code,
        courseTitle: schema.courses.title,
        status: schema.attendanceStatus,
        mode: r.attendanceMode,
        late: r.late,
      })
      .from(r)
      .innerJoin(s, eq(s.id, r.studentId))
      .innerJoin(m, eq(m.id, r.classMeetingId))
      .innerJoin(schema.courseOfferings, eq(schema.courseOfferings.id, m.courseOfferingId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseOfferings.courseId))
      .where(and(eq(s.userId, userId), inArray(m.state, ["LIVE", "ENDED"])))
      .orderBy(asc(schema.courses.code), asc(m.scheduledStart));
    const courses = new Map<string, MyAttendance["courses"][number]>();
    for (const row of rows) {
      let course = courses.get(row.offeringId);
      if (course === undefined) {
        course = {
          offeringId: row.offeringId,
          courseCode: row.courseCode,
          courseTitle: row.courseTitle,
          summary: { present: 0, partial: 0, absent: 0, excused: 0, late: 0 },
          meetings: [],
        };
        courses.set(row.offeringId, course);
      }
      const status = row.status as MyAttendance["courses"][number]["meetings"][number]["status"];
      course.summary[status.toLowerCase() as "present" | "partial" | "absent" | "excused"]++;
      if (row.late) course.summary.late++;
      course.meetings.push({
        meetingId: row.meetingId,
        title: row.title,
        scheduledStart: row.scheduledStart.toISOString(),
        status,
        mode: row.mode as MyAttendance["courses"][number]["meetings"][number]["mode"],
        late: row.late,
        final: row.finalizedAt !== null,
      });
    }
    return { courses: [...courses.values()] };
  }

  // ---- helpers ----

  /** Serializes recompute and finalize per meeting (§12.5). */
  private async lock(db: Database, meetingId: string): Promise<MeetingRow | null> {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${meetingId}))`);
    const m = schema.classMeetings;
    const [meeting] = await db.select().from(m).where(eq(m.id, meetingId));
    return meeting ?? null;
  }

  private locked(meeting: MeetingRow): boolean {
    if (meeting.finalizedAt === null) return false;
    const lockAt = meeting.finalizedAt.getTime() + snapshot(meeting).policy.lockAfterDays * DAY;
    return this.clock.now().getTime() > lockAt;
  }

  /**
   * Runs `computeAttendance` for the meeting and writes only the computed fields that changed
   * (`calc_version + 1`). Students enrolled at any instant of the meeting are evaluated: one who
   * dropped before it started has no record, one who joined the course during it does.
   */
  private async compute(
    db: Database,
    meeting: MeetingRow,
  ): Promise<{ changed: number; shortConference: boolean }> {
    const { version, policy } = snapshot(meeting);
    const ce = schema.courseEnrollments;
    const enrolled = await db
      .selectDistinct({ studentId: ce.studentId })
      .from(ce)
      .where(
        and(
          eq(ce.courseOfferingId, meeting.courseOfferingId),
          lte(ce.enrolledAt, meeting.scheduledEnd),
          or(isNull(ce.droppedAt), gte(ce.droppedAt, meeting.scheduledStart)),
        ),
      );
    const marks = await db
      .select()
      .from(schema.rollCallMarks)
      .where(eq(schema.rollCallMarks.classMeetingId, meeting.id));
    const rollCall: Record<string, RollCallInput> = {};
    for (const mark of marks)
      rollCall[mark.studentId] = {
        present: mark.present,
        late: mark.late,
        mode: mark.mode as RollCallInput["mode"],
      };
    const now = this.clock.now();
    const outcome = computeAttendance({
      scheduledStart: meeting.scheduledStart,
      scheduledEnd: meeting.scheduledEnd,
      // v1: no provider, so no conference or participant evidence (spec).
      conferences: [],
      online: {},
      capAt: now,
      policy,
      enrolledStudentIds: enrolled.map((e) => e.studentId),
      rollCall,
    });

    const r = schema.attendanceRecords;
    const existing = new Map(
      (await db.select().from(r).where(eq(r.classMeetingId, meeting.id))).map((row) => [
        row.studentId,
        row,
      ]),
    );
    let changed = 0;
    for (const result of outcome.results) {
      const fields = {
        computedStatus: result.computedStatus,
        attendanceMode: result.attendanceMode,
        attendedSeconds: result.attendedSeconds,
        effectiveSeconds: result.effectiveSeconds,
        ratioBp: result.ratioBp,
        firstJoinAt: result.firstJoinAt,
        lastLeaveAt: result.lastLeaveAt,
        late: result.late,
        joinCount: result.joinCount,
        policyVersion: version,
        computedAt: now,
      };
      const row = existing.get(result.studentId);
      if (row === undefined) {
        await db.insert(r).values({
          classMeetingId: meeting.id,
          studentId: result.studentId,
          ...fields,
          createdAt: now,
          updatedAt: now,
        });
        changed++;
      } else if (!unchanged(row, result)) {
        await db
          .update(r)
          .set({ ...fields, calcVersion: sql`${r.calcVersion} + 1`, updatedAt: now })
          .where(eq(r.id, row.id));
        changed++;
      }
    }
    return { changed, shortConference: outcome.shortConference };
  }
}
