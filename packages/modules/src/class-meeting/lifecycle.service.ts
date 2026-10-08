import { joinWindowPolicy, type ClassMeeting, type ClassMeetingState } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { AuthorizationService } from "@glim/modules/authorization";
import { PolicyService } from "@glim/modules/identity";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { ClassMeetingsService } from "./class-meetings.service";
import type { MeetingRow } from "./meeting-writer";
import { tickEvent, transition, type MeetingEvent } from "./state-machine";

/** Whether roll call has marks for a meeting; attendance registers the real check (ticket 26). */
export type RollCallCheck = (db: Database, meetingId: string) => Promise<boolean>;

export interface JoinView {
  meetingId: string;
  state: ClassMeetingState;
  onlineLink: string;
  role: "STUDENT" | "STAFF";
  window: { opensAt: string; closesAt: string };
  room: { code: string; name: string } | null;
}

const MINUTE = 60_000;
/** The tick looks at meetings starting within this far ahead (the widest join window). */
const TICK_LOOKAHEAD_MINUTES = 24 * 60;

/** The join-window policy a meeting was created under (§11.4: snapshot, not the live policy). */
function windowPolicy(row: MeetingRow) {
  const snapshot = row.policySnapshot as { joinWindow?: { config?: unknown } } | null;
  return joinWindowPolicy.parse(snapshot?.joinWindow?.config ?? {});
}

/**
 * The Class Meeting lifecycle (owner: class-meeting, TRD §11.4, §11.6; v1 interim): the
 * database-only join, the Lecturer's Start and End, and the minute tick that opens classes,
 * ends overrunning ones and marks no-shows.
 */
@Injectable()
export class MeetingLifecycleService {
  private rollCall: RollCallCheck = () => Promise.resolve(false);

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(ClassMeetingsService) private readonly meetings: ClassMeetingsService,
  ) {}

  /**
   * Attendance records its progress on the meeting (owner: class-meeting): PROVISIONAL once
   * records exist, then FINAL (or REVIEW_REQUIRED) with `finalized_at` (§12.6).
   */
  async recordAttendanceState(
    db: Database,
    id: string,
    change: {
      attendanceState: "PROVISIONAL" | "FINAL" | "REVIEW_REQUIRED";
      finalizedAt?: Date;
    },
  ): Promise<void> {
    const m = schema.classMeetings;
    await db
      .update(m)
      .set({
        attendanceState: change.attendanceState,
        ...(change.finalizedAt === undefined ? {} : { finalizedAt: change.finalizedAt }),
        updatedAt: this.clock.now(),
      })
      .where(eq(m.id, id));
  }

  /** Attendance tells the lifecycle whether roll call was taken (no-show vs ended). */
  registerRollCallCheck(check: RollCallCheck): void {
    this.rollCall = check;
  }

  /**
   * Join (§11.6, v1 spec): authorized by the caller already; checks the state and the window,
   * logs the attempt, and returns the stored link. Students: 15 minutes before to an hour after
   * (or any time while live). Staff: an hour before to the end of the maximum overrun.
   */
  async join(id: string, userId: string): Promise<DomainResult<JoinView>> {
    const m = schema.classMeetings;
    const r = schema.rooms;
    const [found] = await this.db.read
      .select({ meeting: m, room: { code: r.code, name: r.name } })
      .from(m)
      .leftJoin(r, eq(r.id, m.roomId))
      .where(eq(m.id, id));
    if (found === undefined) return err(domainError("NOT_FOUND", "Not found."));
    const { meeting, room } = found;
    const staff =
      (await this.authorization.authorize(
        this.authorization.principal(userId),
        "meeting:class-meeting:start",
        { type: "class-meeting", id },
      )) === "ALLOW";
    const policy = windowPolicy(meeting);
    const opensAt = new Date(
      meeting.scheduledStart.getTime() -
        (staff ? policy.staffOpensBeforeMinutes : policy.studentOpensBeforeMinutes) * MINUTE,
    );
    const closesAt = new Date(
      meeting.scheduledEnd.getTime() +
        (staff ? policy.maxOverrunMinutes : policy.studentClosesAfterMinutes) * MINUTE,
    );
    const now = this.clock.now();
    const inWindow = now >= opensAt && now <= closesAt;

    let denied: {
      code: "MEETING_STATE_INVALID" | "JOIN_WINDOW_CLOSED" | "ONLINE_LINK_NOT_SET";
      message: string;
    } | null = null;
    if (meeting.state === "CANCELLED" || meeting.state === "NO_SHOW")
      denied = {
        code: "MEETING_STATE_INVALID",
        message:
          meeting.state === "CANCELLED"
            ? "This class was cancelled."
            : "This class didn't take place.",
      };
    else if (!inWindow && !(meeting.state === "LIVE" && !staff))
      denied = {
        code: "JOIN_WINDOW_CLOSED",
        message:
          now < opensAt
            ? `You can join from ${String(staff ? policy.staffOpensBeforeMinutes : policy.studentOpensBeforeMinutes)} minutes before the class starts.`
            : "This class has finished.",
      };
    else if (meeting.onlineLink === null)
      denied = {
        code: "ONLINE_LINK_NOT_SET",
        message: "The Lecturer hasn't added the online link yet. Please check again shortly.",
      };

    await this.db.withTx(({ db }) =>
      db.insert(schema.meetingJoinLog).values({
        classMeetingId: id,
        userId,
        outcome: denied === null ? "AUTHORIZED" : "DENIED",
        denyReason: denied?.code ?? null,
        authorizedAt: now,
        createdAt: now,
      }),
    );
    if (denied !== null) return err(domainError(denied.code, denied.message));
    return ok({
      meetingId: id,
      state: meeting.state as ClassMeetingState,
      onlineLink: meeting.onlineLink ?? "",
      role: staff ? "STAFF" : "STUDENT",
      window: { opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString() },
      room,
    });
  }

  /**
   * Start (§11.6, v1 interim): from the staff window's opening, a SCHEDULED or OPEN class goes
   * LIVE (or an accidentally ended one goes LIVE again within the overrun). Returns what the
   * Lecturer needs in the room: the link and the recording notice.
   */
  async start(
    id: string,
    actor: AuditActor,
  ): Promise<
    DomainResult<{ meeting: ClassMeeting; onlineLink: string | null; recordingNotice: string }>
  > {
    const changed = await this.apply(id, "START", actor, (row, now) => {
      const policy = windowPolicy(row);
      const opensAt = row.scheduledStart.getTime() - policy.staffOpensBeforeMinutes * MINUTE;
      return now.getTime() < opensAt
        ? domainError(
            "JOIN_WINDOW_CLOSED",
            `You can start the class from ${String(policy.staffOpensBeforeMinutes)} minutes before it begins.`,
          )
        : null;
    });
    if (!changed.ok) return changed;
    const recording = await this.policies.current("RECORDING");
    const [meeting] = await this.meetings.viewAll([id]);
    if (meeting === undefined) return err(domainError("NOT_FOUND", "Not found."));
    return ok({
      meeting,
      onlineLink: meeting.onlineLink,
      recordingNotice: recording.config.noticeText,
    });
  }

  /** End: a LIVE class (or one with roll call that never went online) becomes ENDED. */
  async end(id: string, actor: AuditActor): Promise<DomainResult<ClassMeeting>> {
    const changed = await this.apply(id, "END", actor);
    if (!changed.ok) return changed;
    const [meeting] = await this.meetings.viewAll([id]);
    return meeting === undefined ? err(domainError("NOT_FOUND", "Not found.")) : ok(meeting);
  }

  /**
   * The `meeting.tick` job (every minute): opens classes as their join window starts, ends live
   * classes past the maximum overrun, and closes classes whose window has passed: NO_SHOW if
   * never started and no roll call, otherwise ENDED. Each meeting changes in its own transaction.
   */
  async tick(): Promise<Record<string, number>> {
    const now = this.clock.now();
    const m = schema.classMeetings;
    const candidates = await this.db.read
      .select()
      .from(m)
      .where(
        and(
          inArray(m.state, ["SCHEDULED", "OPEN", "LIVE"]),
          lte(m.scheduledStart, new Date(now.getTime() + TICK_LOOKAHEAD_MINUTES * MINUTE)),
        ),
      );
    const counts: Record<string, number> = {};
    for (const row of candidates) {
      const policy = windowPolicy(row);
      const event = tickEvent({
        state: row.state as ClassMeetingState,
        start: row.scheduledStart,
        end: row.scheduledEnd,
        now,
        studentOpensBeforeMinutes: policy.studentOpensBeforeMinutes,
        studentClosesAfterMinutes: policy.studentClosesAfterMinutes,
        maxOverrunMinutes: policy.maxOverrunMinutes,
      });
      if (event === null) continue;
      const result = await this.apply(row.id, event, { userId: null, type: "JOB" });
      if (result.ok) counts[result.value] = (counts[result.value] ?? 0) + 1;
    }
    if (Object.keys(counts).length > 0) this.logger.info({ counts }, "meeting tick");
    return counts;
  }

  /**
   * Applies one event to a locked meeting through the state machine, with its side effects:
   * timestamps, the audit row and the domain event.
   */
  private apply(
    id: string,
    event: MeetingEvent,
    actor: AuditActor,
    precondition?: (row: MeetingRow, now: Date) => ReturnType<typeof domainError> | null,
  ): Promise<DomainResult<ClassMeetingState>> {
    return this.db.withTxResult(async ({ db, boss }) => {
      const m = schema.classMeetings;
      const [row] = await db.select().from(m).where(eq(m.id, id)).for("update");
      if (row === undefined) return err(domainError("NOT_FOUND", "Not found."));
      const now = this.clock.now();
      const problem = precondition?.(row, now) ?? null;
      if (problem !== null) return err(problem);
      const policy = windowPolicy(row);
      const result = transition(row.state as ClassMeetingState, event, {
        everStarted: row.firstConferenceStartedAt !== null,
        hasRollCall: await this.rollCall(db, id),
        withinOverrun:
          now.getTime() <= row.scheduledEnd.getTime() + policy.maxOverrunMinutes * MINUTE,
        finalized: row.finalizedAt !== null,
      });
      if (!result.ok) return err(domainError(result.code, result.message));
      await db
        .update(m)
        .set({
          state: result.to,
          ...(result.to === "LIVE" && row.firstConferenceStartedAt === null
            ? { firstConferenceStartedAt: now }
            : {}),
          ...(result.to === "ENDED" ? { lastConferenceEndedAt: now } : {}),
          updatedAt: now,
          version: sql`${m.version} + 1`,
        })
        .where(eq(m.id, id));
      await this.audit.record(db, actor, {
        action: `meeting.class-meeting.${result.to.toLowerCase().replace("_", "-")}`,
        resourceType: "class-meeting",
        resourceId: id,
        metadata: { from: row.state, to: result.to, event },
      });
      const name =
        result.to === "LIVE" ? "meeting.started" : result.to === "ENDED" ? "meeting.ended" : null;
      if (name !== null)
        await boss.publish(
          name,
          { meetingId: id, offeringId: row.courseOfferingId },
          { occurredAt: now, actorUserId: actor.userId },
        );
      return ok(result.to);
    });
  }
}
