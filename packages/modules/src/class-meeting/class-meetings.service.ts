import {
  MEET_LINK_PATTERN,
  type ClassMeeting,
  type EnumValue,
  type ScheduleConflict,
  type ScheduleWarning,
} from "@glim/contracts";
import { Db, PG, pgError, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { AuthorizationService, RoleService } from "@glim/modules/authorization";
import { PolicyService, SettingsService } from "@glim/modules/identity";
import { SchedulingService } from "@glim/modules/scheduling";
import {
  CLOCK,
  definedFields,
  domainError,
  err,
  ok,
  type Clock,
  type DomainError,
  type DomainResult,
  type Patch,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";

type MeetingRow = typeof schema.classMeetings.$inferSelect;
type RecordingMode = EnumValue<"class_meetings.recording_mode">;

export interface NewClassMeeting {
  title: string;
  description?: string | null | undefined;
  scheduledStart: string;
  scheduledEnd: string;
  roomId?: string | null | undefined;
  onlineLink?: string | null | undefined;
  recordingMode?: RecordingMode | undefined;
  overrideConflicts?: boolean | undefined;
  reason?: string | undefined;
}

export interface ClassMeetingChange {
  title: string;
  description: string | null;
  onlineLink: string | null;
  recordingMode: RecordingMode;
}

/** The longest Class Meeting, as for a series (§6.4: 5 to 600 minutes). */
const MAX_MINUTES = 600;
const MIN_MINUTES = 5;
/** `/me/schedule` defaults to the next two weeks. */
const DEFAULT_WINDOW_DAYS = 14;
/** Offerings that can still be scheduled. */
const SCHEDULABLE = ["DRAFT", "PUBLISHED", "ACTIVE"];

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const invalid = (path: string, message: string) =>
  domainError("VALIDATION_FAILED", message, {
    fieldErrors: [{ path: `body.${path}`, code: "invalid", message }],
  });

/** An empty link means "no link"; anything else must be a Google Meet URL (v1 spec). */
function normaliseLink(link: string | null | undefined): DomainResult<string | null | undefined> {
  if (link === undefined) return ok(undefined);
  if (link === null || link.trim() === "") return ok(null);
  return MEET_LINK_PATTERN.test(link.trim())
    ? ok(link.trim())
    : err(
        domainError(
          "ONLINE_LINK_INVALID",
          "Paste a Google Meet link, like https://meet.google.com/abc-defg-hij.",
          {
            fieldErrors: [
              { path: "body.onlineLink", code: "invalid", message: "Not a Google Meet link." },
            ],
          },
        ),
      );
}

/**
 * Class Meetings (owner: class-meeting, TRD §11; v1 spec: the Lecturer pastes the online link and
 * meetings are created ready, with no provider). Scheduling's conflict rules (§9.5) run in the
 * creating transaction; the exclusion constraints are the final word.
 */
@Injectable()
export class ClassMeetingsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
  ) {}

  /**
   * Schedules a Class Meeting (§11.6, without provisioning). A busy Lecturer is
   * `LECTURER_SCHEDULE_CONFLICT` unless an Academic Admin overrides it with a reason; a booked
   * Room is `ROOM_CONFLICT`, with no override. Students with another meeting then are a warning.
   */
  async create(
    offeringId: string,
    input: NewClassMeeting,
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<{ meeting: ClassMeeting; warnings: ScheduleWarning[] }>> {
    const start = new Date(input.scheduledStart);
    const end = new Date(input.scheduledEnd);
    const minutes = (end.getTime() - start.getTime()) / 60_000;
    if (minutes < MIN_MINUTES)
      return err(invalid("scheduledEnd", "A Class Meeting lasts at least 5 minutes."));
    if (minutes > MAX_MINUTES)
      return err(invalid("scheduledEnd", "A Class Meeting lasts at most 10 hours."));
    if (start.getTime() <= this.clock.now().getTime())
      return err(invalid("scheduledStart", "Choose a start time in the future."));
    const link = normaliseLink(input.onlineLink);
    if (!link.ok) return link;

    let override: { reason: string } | null = null;
    if (input.overrideConflicts === true) {
      const roles = await this.roles.activeRoles(actor.userId);
      if (!roles.includes("ACADEMIC_ADMIN"))
        return err(
          domainError("FORBIDDEN", "Only an Academic Admin can book over a Lecturer's schedule."),
        );
      if (input.reason === undefined)
        return err(invalid("reason", "Give a reason for booking over the Lecturer's schedule."));
      override = { reason: input.reason };
    }

    const o = schema.courseOfferings;
    const [offering] = await this.db.read
      .select({ status: o.status })
      .from(o)
      .where(eq(o.id, offeringId));
    if (offering === undefined) return notFound();
    if (!SCHEDULABLE.includes(offering.status))
      return err(
        domainError(
          "CONFLICT",
          `Class Meetings can't be scheduled for a ${offering.status.toLowerCase()} offering.`,
        ),
      );
    const roomId = input.roomId ?? null;
    if (roomId !== null) {
      const r = schema.rooms;
      const [room] = await this.db.read
        .select({ status: r.status })
        .from(r)
        .where(eq(r.id, roomId));
      if (room?.status !== "ACTIVE") return err(invalid("roomId", "Choose an active Room."));
    }

    // Report every meeting in the way up front; the constraints still catch a race below.
    const time = { offeringId, start, end };
    const blocked = await this.conflictError(time, roomId, override === null);
    if (blocked !== null) return err(blocked);

    let created: MeetingRow;
    try {
      created = await this.db.withTx(async ({ db, boss }) => {
        const now = this.clock.now();
        const [joinWindow, attendance, institution] = await Promise.all([
          this.policies.current("JOIN_WINDOW", db),
          this.policies.current("ATTENDANCE", db),
          this.settings.get(db),
        ]);
        const [row] = await db
          .insert(schema.classMeetings)
          .values({
            courseOfferingId: offeringId,
            title: input.title,
            description: input.description ?? null,
            scheduledStart: start,
            scheduledEnd: end,
            timezone: institution.timezone,
            roomId,
            onlineLink: link.value ?? null,
            recordingMode: input.recordingMode ?? "AUTO",
            policySnapshot: {
              joinWindow: { version: joinWindow.version, config: joinWindow.config },
              attendance: { version: attendance.version, config: attendance.config },
            },
            createdBy: actor.userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (row === undefined) throw new Error("class meeting insert returned nothing");
        await this.scheduling.bookLecturers(db, { ...time, meetingId: row.id }, override);
        await this.audit.record(db, actor, {
          action: "meeting.class-meeting.created",
          resourceType: "class-meeting",
          resourceId: row.id,
          metadata: {
            offeringId,
            roomId,
            scheduledStart: start.toISOString(),
            scheduledEnd: end.toISOString(),
            ...(override === null ? {} : { overrideConflicts: true, reason: override.reason }),
          },
        });
        await boss.publish(
          "meeting.scheduled",
          { meetingId: row.id, offeringId },
          { occurredAt: now, actorUserId: actor.userId },
        );
        return row;
      });
    } catch (error) {
      const raced = await this.fromConstraint(error, time, roomId);
      if (raced === null) throw error;
      return err(raced);
    }

    const warning = await this.scheduling.studentClash({ ...time, meetingId: created.id });
    const meeting = await this.view(created.id, true);
    if (meeting === null) throw new Error("created meeting vanished");
    return ok({ meeting, warnings: warning === null ? [] : [warning] });
  }

  /** An offering's meetings, earliest first. The online link only for people who manage them. */
  async listForOffering(offeringId: string, viewerUserId: string): Promise<ClassMeeting[]> {
    const manages = await this.manages(viewerUserId, offeringId);
    return this.query(eq(schema.classMeetings.courseOfferingId, offeringId), manages);
  }

  async get(id: string, viewerUserId: string): Promise<ClassMeeting | null> {
    const offeringId = await this.offeringOf(id);
    if (offeringId === null) return null;
    return this.view(id, await this.manages(viewerUserId, offeringId));
  }

  /** Title, description, online link and recording mode. Times and the Room move by reschedule. */
  async update(
    id: string,
    expectedVersion: number,
    patch: Patch<ClassMeetingChange>,
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<ClassMeeting>> {
    const link = normaliseLink(patch.onlineLink);
    if (!link.ok) return link;
    const result = await this.db.withTxResult(async ({ db }) => {
      const m = schema.classMeetings;
      const [current] = await db.select().from(m).where(eq(m.id, id)).for("update");
      if (current === undefined) return notFound();
      if (current.version !== expectedVersion)
        return err(
          domainError(
            "VERSION_MISMATCH",
            "Someone else changed this Class Meeting. Reload and try again.",
          ),
        );
      if (current.state === "CANCELLED" || current.state === "ENDED" || current.state === "NO_SHOW")
        return err(
          domainError(
            "MEETING_STATE_INVALID",
            `This Class Meeting is ${current.state.toLowerCase().replace("_", " ")}; it can't change.`,
          ),
        );
      const change = definedFields({ ...patch, onlineLink: link.value });
      await db
        .update(m)
        .set({ ...change, updatedAt: this.clock.now(), version: sql`${m.version} + 1` })
        .where(eq(m.id, id));
      await this.audit.record(db, actor, {
        action: "meeting.class-meeting.updated",
        resourceType: "class-meeting",
        resourceId: id,
        // The link itself isn't secret, but there's no need to copy it into the log.
        metadata: { fields: Object.keys(change) },
      });
      return ok(current.courseOfferingId);
    });
    if (!result.ok) return result;
    const meeting = await this.view(id, true);
    return meeting === null ? notFound() : ok(meeting);
  }

  /**
   * The viewer's meetings between two instants: as a student, on offerings they're ENROLLED on;
   * as a Lecturer, on offerings they're assigned to (§7.2, via `v_offering_access`).
   */
  async schedule(
    userId: string,
    window: { from?: string | undefined; to?: string | undefined },
  ): Promise<(ClassMeeting & { as: "STUDENT" | "LECTURER" })[]> {
    const from = window.from === undefined ? this.clock.now() : new Date(window.from);
    const to =
      window.to === undefined
        ? new Date(from.getTime() + DEFAULT_WINDOW_DAYS * 86_400_000)
        : new Date(window.to);
    const { rows: access } = await this.db.read.execute<{
      course_offering_id: string;
      access_kind: "STUDENT" | "STAFF";
    }>(sql`
      SELECT DISTINCT a.course_offering_id, a.access_kind
        FROM v_offering_access a
        JOIN course_offerings o ON o.id = a.course_offering_id
       WHERE a.user_id = ${userId}
         AND (a.access_kind = 'STAFF' OR (a.source_status = 'ENROLLED' AND o.status IN ('PUBLISHED', 'ACTIVE')))`);
    if (access.length === 0) return [];
    const teaching = new Set(
      access.filter((a) => a.access_kind === "STAFF").map((a) => a.course_offering_id),
    );
    const managed = new Set<string>();
    for (const offeringId of teaching)
      if (await this.manages(userId, offeringId)) managed.add(offeringId);
    const m = schema.classMeetings;
    const meetings = await this.query(
      and(
        inArray(
          m.courseOfferingId,
          access.map((a) => a.course_offering_id),
        ),
        lt(m.scheduledStart, to),
        gte(m.scheduledEnd, from),
      ),
      (offeringId) => managed.has(offeringId),
    );
    return meetings.map((meeting) => ({
      ...meeting,
      as: teaching.has(meeting.courseOfferingId) ? "LECTURER" : "STUDENT",
    }));
  }

  /** The offering a meeting belongs to, for authorization (§7.2). */
  async offeringOf(id: string): Promise<string | null> {
    const m = schema.classMeetings;
    const [row] = await this.db.read
      .select({ offeringId: m.courseOfferingId })
      .from(m)
      .where(eq(m.id, id));
    return row?.offeringId ?? null;
  }

  // ---- helpers ----

  /** The blocking conflicts for a new meeting at this time, as one error; null if none. */
  private async conflictError(
    time: { offeringId: string; start: Date; end: Date; meetingId?: string },
    roomId: string | null,
    checkLecturers: boolean,
  ): Promise<DomainError | null> {
    if (roomId !== null) {
      const conflicts = await this.scheduling.roomConflicts(roomId, time);
      if (conflicts.length > 0) return roomConflict(conflicts);
    }
    if (checkLecturers) {
      const conflicts = await this.scheduling.lecturerConflicts(time);
      if (conflicts.length > 0) return lecturerConflict(conflicts);
    }
    return null;
  }

  /** A create that lost a race: the exclusion constraint fired after the up-front check passed. */
  private async fromConstraint(
    error: unknown,
    time: { offeringId: string; start: Date; end: Date },
    roomId: string | null,
  ): Promise<DomainError | null> {
    const pg = pgError(error);
    if (pg?.code !== PG.EXCLUSION_VIOLATION) return null;
    if (pg.constraint === "no_room_double_booking" && roomId !== null)
      return roomConflict(await this.scheduling.roomConflicts(roomId, time));
    if (pg.constraint === "no_lecturer_overlap")
      return lecturerConflict(await this.scheduling.lecturerConflicts(time));
    return null;
  }

  private async manages(userId: string, offeringId: string): Promise<boolean> {
    const decision = await this.authorization.authorize(
      this.authorization.principal(userId),
      "meeting:class-meeting:manage",
      { type: "course-offering", id: offeringId },
    );
    return decision === "ALLOW";
  }

  private async view(id: string, manages: boolean): Promise<ClassMeeting | null> {
    const [meeting] = await this.query(eq(schema.classMeetings.id, id), manages);
    return meeting ?? null;
  }

  private async query(
    where: SQL | undefined,
    manages: boolean | ((offeringId: string) => boolean),
    db: Database = this.db.read,
  ): Promise<ClassMeeting[]> {
    const m = schema.classMeetings;
    const c = schema.courses;
    const r = schema.rooms;
    const rows = await db
      .select({
        meeting: m,
        courseCode: c.code,
        courseTitle: c.title,
        room: { id: r.id, code: r.code, name: r.name },
      })
      .from(m)
      .innerJoin(schema.courseOfferings, eq(schema.courseOfferings.id, m.courseOfferingId))
      .innerJoin(c, eq(c.id, schema.courseOfferings.courseId))
      .leftJoin(r, eq(r.id, m.roomId))
      .where(where)
      .orderBy(asc(m.scheduledStart));
    return rows.map(({ meeting, courseCode, courseTitle, room }) => {
      const showLink = typeof manages === "function" ? manages(meeting.courseOfferingId) : manages;
      return {
        id: meeting.id,
        courseOfferingId: meeting.courseOfferingId,
        courseCode,
        courseTitle,
        seriesId: meeting.seriesId,
        title: meeting.title,
        description: meeting.description,
        scheduledStart: meeting.scheduledStart.toISOString(),
        scheduledEnd: meeting.scheduledEnd.toISOString(),
        timezone: meeting.timezone,
        room,
        hasOnlineLink: meeting.onlineLink !== null,
        onlineLink: showLink ? meeting.onlineLink : null,
        state: meeting.state as ClassMeeting["state"],
        recordingMode: meeting.recordingMode as RecordingMode,
        version: meeting.version,
      };
    });
  }
}

function roomConflict(conflicts: ScheduleConflict[]): DomainError {
  return domainError(
    "ROOM_CONFLICT",
    "The Room is booked for another Class Meeting at that time. Choose another Room or time.",
    { conflicts },
  );
}

function lecturerConflict(conflicts: ScheduleConflict[]): DomainError {
  return domainError(
    "LECTURER_SCHEDULE_CONFLICT",
    "A Lecturer on this course already has a Class Meeting at that time.",
    { conflicts },
  );
}
