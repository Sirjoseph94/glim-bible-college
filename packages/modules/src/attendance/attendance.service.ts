import {
  attendancePolicy,
  type AttendanceReport,
  type MeetingAttendance,
  type MyAttendance,
} from "@glim/contracts";
import { Db, schema, type Database, type TxQueue } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { RoleService } from "@glim/modules/authorization";
import { MeetingLifecycleService } from "@glim/modules/class-meeting";
import { NotificationsService } from "@glim/modules/notifications";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { toLocalDate } from "@glim/shared/time";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  computeAttendance,
  unresolvedParticipants,
  type AttendanceResult,
  type RollCallInput,
} from "./domain/compute";
import { ParticipantsService } from "./participants.service";

type MeetingRow = typeof schema.classMeetings.$inferSelect;
type RecordRow = typeof schema.attendanceRecords.$inferSelect;
type RecordView = MeetingAttendance["records"][number];

const DAY = 86_400_000;

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
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ParticipantsService) private readonly participants: ParticipantsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(RoleService) private readonly roles: RoleService,
  ) {}

  /** The `attendance.recompute` job. Returns how many records changed, or why it didn't run. */
  recompute(meetingId: string): Promise<number | "LOCKED" | "SKIPPED"> {
    return this.db.withTx(async ({ db }) => {
      const meeting = await this.lock(db, meetingId);
      if (meeting === null || meeting.state === "CANCELLED" || meeting.state === "NO_SHOW")
        return "SKIPPED";
      if (this.locked(meeting)) return "LOCKED";
      const { changed, review } = await this.compute(db, meeting);
      if (meeting.attendanceState === "PENDING")
        await this.lifecycle.recordAttendanceState(db, meetingId, {
          attendanceState: "PROVISIONAL",
        });
      // Everything a reviewer needed to resolve has been: the meeting's attendance is final.
      if (meeting.attendanceState === "REVIEW_REQUIRED" && !review)
        await this.lifecycle.recordAttendanceState(db, meetingId, { attendanceState: "FINAL" });
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
   * The `class-meeting.finalize` job (§12.6): with Google Meet, reads every conference's
   * participants one last time; then computes the records, and marks the meeting FINAL — or
   * REVIEW_REQUIRED, telling its Lecturers, when the call was short and students lack a roll-call
   * mark, or someone unidentified was in it for longer than `unmatchedReviewMinutes` — with
   * `finalized_at`, and emits `attendance.finalized`. Skips a meeting that has gone live again,
   * or is already finalized.
   */
  async finalize(meetingId: string): Promise<"FINAL" | "REVIEW_REQUIRED" | "SKIPPED"> {
    const m = schema.classMeetings;
    const [before] = await this.db.read.select().from(m).where(eq(m.id, meetingId));
    if (before === undefined || before.state !== "ENDED" || before.finalizedAt !== null)
      return "SKIPPED";
    if (before.provider !== null) {
      const c = schema.conferenceRecords;
      const records = await this.db.read
        .select({ id: c.id })
        .from(c)
        .where(eq(c.classMeetingId, meetingId));
      // A provider outage throws here, and the job is retried (§11.10).
      for (const record of records) await this.participants.syncConference(record.id);
    }
    return this.db.withTx(async (tx) => {
      const { db, boss } = tx;
      const meeting = await this.lock(db, meetingId);
      if (meeting === null || meeting.state !== "ENDED" || meeting.finalizedAt !== null)
        return "SKIPPED";
      const { review } = await this.compute(db, meeting);
      const state = review ? "REVIEW_REQUIRED" : "FINAL";
      const now = this.clock.now();
      await this.lifecycle.recordAttendanceState(db, meetingId, {
        attendanceState: state,
        finalizedAt: now,
      });
      if (review) await this.askForReview(tx, meeting);
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
    const { policy } = snapshot(meeting);
    const lockedAt =
      meeting.finalizedAt === null
        ? null
        : new Date(meeting.finalizedAt.getTime() + policy.lockAfterDays * DAY);
    // The denominator the records used; 0 means the class never ran online (roll call only).
    const longest = Math.max(0, ...rows.map(({ record }) => record.effectiveSeconds));
    const ranSeconds = longest > 0 ? longest : null;
    return {
      meetingId,
      attendanceState: meeting.attendanceState as MeetingAttendance["attendanceState"],
      finalizedAt: meeting.finalizedAt?.toISOString() ?? null,
      lockedAt: lockedAt?.toISOString() ?? null,
      rule: {
        basis: policy.basis,
        presentThresholdBp: policy.presentThresholdBp,
        partialThresholdBp: policy.partialThresholdBp,
        lateGraceMinutes: policy.lateGraceMinutes,
      },
      ranSeconds,
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

  /**
   * Overrides a student's attendance with a reason (§12.7), or clears the override (`status`
   * null). Audited with an event in the same transaction; recompute never touches it, and it's
   * allowed after the lock too.
   */
  async setOverride(
    meetingId: string,
    studentId: string,
    change: { status: RecordView["status"]; reason: string } | null,
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<RecordView>> {
    const result = await this.db.withTxResult(async ({ db, boss }) => {
      const meeting = await this.lock(db, meetingId);
      if (meeting === null) return err(domainError("NOT_FOUND", "Not found."));
      const r = schema.attendanceRecords;
      const [row] = await db
        .select({ record: r, status: schema.attendanceStatus })
        .from(r)
        .where(and(eq(r.classMeetingId, meetingId), eq(r.studentId, studentId)));
      if (row === undefined)
        return err(
          domainError("NOT_FOUND", "There's no attendance for that student in this class yet."),
        );
      if (change === null && row.record.overrideStatus === null) return ok(null);
      const now = this.clock.now();
      await db
        .update(r)
        .set({
          overrideStatus: change?.status ?? null,
          overrideReason: change?.reason ?? null,
          overrideBy: change === null ? null : actor.userId,
          overriddenAt: change === null ? null : now,
          updatedAt: now,
          version: sql`${r.version} + 1`,
        })
        .where(eq(r.id, row.record.id));
      await this.audit.record(db, actor, {
        action:
          change === null ? "attendance.record.override-cleared" : "attendance.record.overridden",
        resourceType: "class-meeting",
        resourceId: meetingId,
        metadata: {
          studentId,
          from: row.status,
          to: change?.status ?? row.record.computedStatus,
          ...(change === null
            ? { clearedReason: row.record.overrideReason }
            : { reason: change.reason }),
        },
      });
      await boss.publish(
        "attendance.record.overridden",
        { meetingId, studentId, status: change?.status ?? null },
        { occurredAt: now, actorUserId: actor.userId },
      );
      return ok(null);
    });
    if (!result.ok) return result;
    const view = await this.forMeeting(meetingId);
    const record = view?.records.find((x) => x.studentId === studentId);
    return record === undefined ? err(domainError("NOT_FOUND", "Not found.")) : ok(record);
  }

  /**
   * The offering's attendance as a student × Class Meeting matrix (§12.7, AC-11): meetings that
   * took place (or have records), each cell with its status and mode, and each meeting with the
   * policy version used.
   */
  async report(offeringId: string): Promise<AttendanceReport | null> {
    const o = schema.courseOfferings;
    const [offering] = await this.db.read
      .select({ id: o.id, courseCode: schema.courses.code, courseTitle: schema.courses.title })
      .from(o)
      .innerJoin(schema.courses, eq(schema.courses.id, o.courseId))
      .where(eq(o.id, offeringId));
    if (offering === undefined) return null;
    const m = schema.classMeetings;
    const meetings = await this.db.read
      .select()
      .from(m)
      .where(
        and(
          eq(m.courseOfferingId, offeringId),
          or(
            inArray(m.state, ["LIVE", "ENDED"]),
            inArray(m.attendanceState, ["PROVISIONAL", "FINAL", "REVIEW_REQUIRED"]),
          ),
        ),
      )
      .orderBy(asc(m.scheduledStart));
    const r = schema.attendanceRecords;
    const records =
      meetings.length === 0
        ? []
        : await this.db.read
            .select({ record: r, status: schema.attendanceStatus })
            .from(r)
            .where(
              inArray(
                r.classMeetingId,
                meetings.map((x) => x.id),
              ),
            );
    const s = schema.students;
    const pe = schema.programmeEnrollments;
    const ce = schema.courseEnrollments;
    const people = await this.db.read
      .selectDistinctOn([s.familyName, s.givenName, s.id], {
        studentId: s.id,
        givenName: s.givenName,
        familyName: s.familyName,
        matricNumber: pe.matricNumber,
      })
      .from(ce)
      .innerJoin(s, eq(s.id, ce.studentId))
      .innerJoin(pe, eq(pe.id, ce.programmeEnrollmentId))
      .where(eq(ce.courseOfferingId, offeringId))
      .orderBy(asc(s.familyName), asc(s.givenName), asc(s.id));
    const cell = new Map(
      records.map((x) => [`${x.record.studentId}:${x.record.classMeetingId}`, x]),
    );
    return {
      offering,
      meetings: meetings.map((meeting) => ({
        meetingId: meeting.id,
        title: meeting.title,
        scheduledStart: meeting.scheduledStart.toISOString(),
        attendanceState:
          meeting.attendanceState as AttendanceReport["meetings"][number]["attendanceState"],
        policyVersion: snapshot(meeting).version,
      })),
      students: people.map((p) => ({
        studentId: p.studentId,
        name: `${p.givenName} ${p.familyName}`,
        matricNumber: p.matricNumber,
        cells: meetings.map((meeting) => {
          const found = cell.get(`${p.studentId}:${meeting.id}`);
          return found === undefined
            ? null
            : {
                status: found.status as RecordView["status"],
                mode: found.record.attendanceMode as RecordView["mode"],
                late: found.record.late,
                overridden: found.record.overrideStatus !== null,
              };
        }),
      })),
    };
  }

  /** The report as CSV rows: one row per student, one column per meeting (date, title, policy). */
  reportCsv(report: AttendanceReport, zone: string): { headers: string[]; rows: string[][] } {
    const headers = [
      "Matric Number",
      "Student",
      ...report.meetings.map(
        (meeting) =>
          `${toLocalDate(meeting.scheduledStart, zone)} ${meeting.title} (policy v${String(meeting.policyVersion ?? 0)})`,
      ),
    ];
    const rows = report.students.map((student) => [
      student.matricNumber,
      student.name,
      ...student.cells.map((c) =>
        c === null
          ? ""
          : `${c.status}${c.mode === "NONE" ? "" : ` ${c.mode}`}${c.late ? " LATE" : ""}${c.overridden ? " *" : ""}`,
      ),
    ]);
    return { headers, rows };
  }

  // ---- helpers ----

  /** A Lecturer task (§12.4): someone in the call needs identifying, or the call was short. */
  private async askForReview(
    tx: { db: Database; boss: TxQueue },
    meeting: MeetingRow,
  ): Promise<void> {
    const a = schema.lecturerAssignments;
    const l = schema.lecturers;
    const lecturers = await tx.db
      .selectDistinct({ userId: l.userId })
      .from(a)
      .innerJoin(l, eq(l.id, a.lecturerId))
      .where(and(eq(a.courseOfferingId, meeting.courseOfferingId), eq(a.status, "ACTIVE")));
    const recipients = lecturers.map((x) => x.userId);
    if (recipients.length === 0)
      recipients.push(...(await this.roles.holders("ACADEMIC_ADMIN", tx.db)));
    for (const userId of recipients)
      await this.notifications.notify(tx, {
        userId,
        kind: "attendance.review-required",
        title: `Check online attendance: ${meeting.title}`,
        data: { meetingId: meeting.id, link: `/teach/meetings/${meeting.id}/attendance` },
        email: false,
        dedupeKey: `attendance-review:${meeting.id}`,
      });
  }

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
  ): Promise<{ changed: number; review: boolean }> {
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
    // Online evidence from Meet (integration slice); a pasted-link meeting has none (v1).
    const studentUsers =
      enrolled.length === 0
        ? []
        : await db
            .select({ id: schema.students.id, userId: schema.students.userId })
            .from(schema.students)
            .where(
              inArray(
                schema.students.id,
                enrolled.map((e) => e.studentId),
              ),
            );
    const evidence =
      meeting.provider === null
        ? { conferences: [], online: {}, participants: [] }
        : await this.participants.evidence(
            db,
            meeting.id,
            new Map(studentUsers.map((x) => [x.userId, x.id])),
          );
    const outcome = computeAttendance({
      scheduledStart: meeting.scheduledStart,
      scheduledEnd: meeting.scheduledEnd,
      conferences: evidence.conferences,
      online: evidence.online,
      capAt: now,
      policy,
      enrolledStudentIds: enrolled.map((e) => e.studentId),
      rollCall,
    });
    const unresolved = unresolvedParticipants({
      scheduledStart: meeting.scheduledStart,
      scheduledEnd: meeting.scheduledEnd,
      conferences: evidence.conferences,
      capAt: now,
      windowPaddingMinutes: policy.windowPaddingMinutes,
      participants: evidence.participants,
    });
    // With no conference data (a pasted link, v1 spec) the review flags don't apply.
    const review =
      meeting.provider !== null &&
      evidence.conferences.length > 0 &&
      (outcome.shortConference ||
        unresolved.some((u) => u.seconds > policy.unmatchedReviewMinutes * 60));

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
    return { changed, review };
  }
}
