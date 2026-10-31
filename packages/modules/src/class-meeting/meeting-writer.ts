import { MEET_LINK_PATTERN, type EnumValue, type ScheduleConflict } from "@glim/contracts";
import { Db, PG, pgError, schema, type Database, type TxQueue } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { RoleService } from "@glim/modules/authorization";
import { PolicyService, SettingsService } from "@glim/modules/identity";
import { NotificationsService } from "@glim/modules/notifications";
import { SchedulingService } from "@glim/modules/scheduling";
import {
  CLOCK,
  domainError,
  err,
  ok,
  type Clock,
  type DomainError,
  type DomainResult,
} from "@glim/shared";
import { toLocalDate } from "@glim/shared/time";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { ProvisioningService } from "./provisioning.service";

export type MeetingRow = typeof schema.classMeetings.$inferSelect;
export type RecordingMode = EnumValue<"class_meetings.recording_mode">;

/** The longest and shortest Class Meeting (§6.4: 5 to 600 minutes, as for a series). */
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 600;
/** Offerings that can still be scheduled. */
const SCHEDULABLE = ["DRAFT", "PUBLISHED", "ACTIVE"];

export const notFound = () => err(domainError("NOT_FOUND", "Not found."));
export const invalid = (path: string, message: string) =>
  domainError("VALIDATION_FAILED", message, {
    fieldErrors: [{ path: `body.${path}`, code: "invalid", message }],
  });

/** An empty link means "no link"; anything else must be a Google Meet URL (v1 spec). */
export function normaliseLink(
  link: string | null | undefined,
): DomainResult<string | null | undefined> {
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

/** A meeting lasts 5 to 600 minutes and starts in the future. */
export function checkTimes(start: Date, end: Date, now: Date): DomainError | null {
  const minutes = (end.getTime() - start.getTime()) / 60_000;
  if (minutes < MIN_MINUTES)
    return invalid("scheduledEnd", "A Class Meeting lasts at least 5 minutes.");
  if (minutes > MAX_MINUTES)
    return invalid("scheduledEnd", "A Class Meeting lasts at most 10 hours.");
  if (start.getTime() <= now.getTime())
    return invalid("scheduledStart", "Choose a start time in the future.");
  return null;
}

/** A Class Meeting must fall within its offering's dates (ADR-0005). */
export function outsideOffering(offering: { startsOn: string; endsOn: string }): DomainError {
  return domainError(
    "OUTSIDE_OFFERING_DATES",
    `Class Meetings for this offering must fall between ${offering.startsOn} and ${offering.endsOn}.`,
  );
}

export function roomConflict(conflicts: ScheduleConflict[]): DomainError {
  return domainError(
    "ROOM_CONFLICT",
    "The Room is booked for another Class Meeting at that time. Choose another Room or time.",
    { conflicts },
  );
}

export function lecturerConflict(conflicts: ScheduleConflict[]): DomainError {
  return domainError(
    "LECTURER_SCHEDULE_CONFLICT",
    "A Lecturer on this course already has a Class Meeting at that time.",
    { conflicts },
  );
}

export interface MeetingSlot {
  start: Date;
  end: Date;
  /** The meeting being moved, which mustn't conflict with itself. */
  meetingId?: string;
}

export interface NewMeetingRow {
  offeringId: string;
  title: string;
  description: string | null;
  start: Date;
  end: Date;
  roomId: string | null;
  onlineLink: string | null;
  recordingMode: RecordingMode;
  seriesId?: string;
  occurrenceDate?: string;
}

/** What enrolled students are told about (§11.9): a new time or Room, or a cancellation. */
export interface MeetingNotice {
  kind: "meeting.rescheduled" | "meeting.cancelled";
  offeringId: string;
  meeting: { id: string; title: string; start: Date; end: Date; roomName: string | null };
  /** How many meetings the change covers (more than one for ALL_FUTURE). */
  count: number;
  reason?: string | undefined;
}

/**
 * The writing side shared by single meetings and series (owner: class-meeting): validation,
 * the conflict rules (§9.5, via scheduling), inserting a meeting with its Lecturer slots, and
 * telling enrolled students about changes.
 */
@Injectable()
export class MeetingWriter {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SchedulingService) readonly scheduling: SchedulingService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(ProvisioningService) readonly provisioning: ProvisioningService,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  /** The institution's timezone, which series and typed times are read in (§5.1). */
  async zone(): Promise<string> {
    return (await this.settings.get()).timezone;
  }

  /** An override needs the Academic Admin role and a reason (§9.5). */
  async override(
    input: { overrideConflicts?: boolean | undefined; reason?: string | undefined },
    userId: string,
  ): Promise<DomainResult<{ reason: string } | null>> {
    if (input.overrideConflicts !== true) return ok(null);
    const roles = await this.roles.activeRoles(userId);
    if (!roles.includes("ACADEMIC_ADMIN"))
      return err(
        domainError("FORBIDDEN", "Only an Academic Admin can book over a Lecturer's schedule."),
      );
    if (input.reason === undefined)
      return err(invalid("reason", "Give a reason for booking over the Lecturer's schedule."));
    return ok({ reason: input.reason });
  }

  async checkOffering(offeringId: string): Promise<DomainError | null> {
    const o = schema.courseOfferings;
    const [offering] = await this.db.read
      .select({ status: o.status })
      .from(o)
      .where(eq(o.id, offeringId));
    if (offering === undefined) return domainError("NOT_FOUND", "Not found.");
    return SCHEDULABLE.includes(offering.status)
      ? null
      : domainError(
          "CONFLICT",
          `Class Meetings can't be scheduled for a ${offering.status.toLowerCase()} offering.`,
        );
  }

  /**
   * Every slot falls within the offering's dates, read in the institution's timezone (ADR-0005):
   * `OUTSIDE_OFFERING_DATES` otherwise.
   */
  async checkWithinOffering(
    offeringId: string,
    slots: { start: Date; end: Date }[],
  ): Promise<DomainError | null> {
    const offering = await this.offeringDates(offeringId);
    if (offering === null) return domainError("NOT_FOUND", "Not found.");
    const zone = await this.zone();
    const outside = slots.some(
      (slot) =>
        toLocalDate(slot.start, zone) < offering.startsOn ||
        toLocalDate(slot.end, zone) > offering.endsOn,
    );
    return outside ? outsideOffering(offering) : null;
  }

  /** The offering's first and last days. */
  async offeringDates(offeringId: string): Promise<{ startsOn: string; endsOn: string } | null> {
    const o = schema.courseOfferings;
    const [row] = await this.db.read
      .select({ startsOn: o.startsOn, endsOn: o.endsOn })
      .from(o)
      .where(eq(o.id, offeringId));
    return row ?? null;
  }

  async checkRoom(roomId: string | null): Promise<DomainError | null> {
    if (roomId === null) return null;
    const r = schema.rooms;
    const [room] = await this.db.read.select({ status: r.status }).from(r).where(eq(r.id, roomId));
    return room?.status === "ACTIVE" ? null : invalid("roomId", "Choose an active Room.");
  }

  /** The blocking conflicts at each time, as one error; null if none. */
  async conflicts(
    offeringId: string,
    slots: MeetingSlot[],
    roomId: string | null,
    checkLecturers: boolean,
  ): Promise<DomainError | null> {
    const rooms: ScheduleConflict[] = [];
    const lecturers: ScheduleConflict[] = [];
    for (const slot of slots) {
      if (roomId !== null) rooms.push(...(await this.scheduling.roomConflicts(roomId, slot)));
      if (checkLecturers)
        lecturers.push(...(await this.scheduling.lecturerConflicts({ ...slot, offeringId })));
    }
    if (rooms.length > 0) return roomConflict(dedupe(rooms));
    if (lecturers.length > 0) return lecturerConflict(dedupe(lecturers));
    return null;
  }

  /** A write that lost a race: an exclusion constraint fired after the up-front check passed. */
  async fromConstraint(
    error: unknown,
    offeringId: string,
    slots: MeetingSlot[],
    roomId: string | null,
  ): Promise<DomainError | null> {
    const pg = pgError(error);
    if (pg?.code !== PG.EXCLUSION_VIOLATION) return null;
    if (pg.constraint === "no_room_double_booking")
      return (await this.conflicts(offeringId, slots, roomId, false)) ?? roomConflict([]);
    if (pg.constraint === "no_lecturer_overlap")
      return (await this.conflicts(offeringId, slots, null, true)) ?? lecturerConflict([]);
    return null;
  }

  /**
   * Inserts a meeting with its policy snapshot and Lecturer slots, audited, with its event, and
   * (with Google Meet on) its provision job, all in the caller's transaction (INV-5, INV-8).
   */
  async insert(
    tx: { db: Database; boss: TxQueue },
    row: NewMeetingRow,
    override: { reason: string } | null,
    actor: AuditActor & { userId: string },
  ): Promise<MeetingRow> {
    const { db, boss } = tx;
    const now = this.clock.now();
    const [joinWindow, attendance, institution, googleMeet] = await Promise.all([
      this.policies.current("JOIN_WINDOW", db),
      this.policies.current("ATTENDANCE", db),
      this.settings.get(db),
      this.provisioning.snapshot(db),
    ]);
    const provider = this.provisioning.providerName;
    const [created] = await db
      .insert(schema.classMeetings)
      .values({
        courseOfferingId: row.offeringId,
        seriesId: row.seriesId ?? null,
        occurrenceDate: row.occurrenceDate ?? null,
        title: row.title,
        description: row.description,
        scheduledStart: row.start,
        scheduledEnd: row.end,
        timezone: institution.timezone,
        roomId: row.roomId,
        onlineLink: row.onlineLink,
        recordingMode: row.recordingMode,
        // With Google Meet on, the worker creates the space (§11.6); otherwise the pasted link.
        provider,
        providerStatus: provider === null ? null : "PENDING",
        policySnapshot: {
          joinWindow: { version: joinWindow.version, config: joinWindow.config },
          attendance: { version: attendance.version, config: attendance.config },
          ...(googleMeet === null ? {} : { googleMeet }),
        },
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (created === undefined) throw new Error("class meeting insert returned nothing");
    await this.provisioning.queueProvision(tx, created);
    await this.scheduling.bookLecturers(
      db,
      { offeringId: row.offeringId, start: row.start, end: row.end, meetingId: created.id },
      override,
    );
    await this.audit.record(db, actor, {
      action: "meeting.class-meeting.created",
      resourceType: "class-meeting",
      resourceId: created.id,
      metadata: {
        offeringId: row.offeringId,
        roomId: row.roomId,
        scheduledStart: row.start.toISOString(),
        scheduledEnd: row.end.toISOString(),
        ...(row.seriesId === undefined ? {} : { seriesId: row.seriesId }),
        ...(override === null ? {} : { overrideConflicts: true, reason: override.reason }),
      },
    });
    await boss.publish(
      "meeting.scheduled",
      { meetingId: created.id, offeringId: row.offeringId },
      { occurredAt: now, actorUserId: actor.userId },
    );
    return created;
  }

  /**
   * Tells the offering's ENROLLED students about a change, in-app and by email (critical,
   * §11.9), with times in each student's own timezone.
   */
  async notifyEnrolled(
    tx: { db: Database; boss: TxQueue },
    notice: MeetingNotice,
  ): Promise<number> {
    const ce = schema.courseEnrollments;
    const s = schema.students;
    const u = schema.users;
    const recipients = await tx.db
      .selectDistinct({ userId: u.id, timezone: u.timezone })
      .from(ce)
      .innerJoin(s, eq(s.id, ce.studentId))
      .innerJoin(u, eq(u.id, s.userId))
      .where(
        and(
          eq(ce.courseOfferingId, notice.offeringId),
          eq(ce.status, "ENROLLED"),
          eq(s.status, "ACTIVE"),
        ),
      );
    if (recipients.length === 0) return 0;
    const institution = await this.settings.get(tx.db);
    const o = schema.courseOfferings;
    const [course] = await tx.db
      .select({ code: schema.courses.code })
      .from(o)
      .innerJoin(schema.courses, eq(schema.courses.id, o.courseId))
      .where(eq(o.id, notice.offeringId));
    const cancelled = notice.kind === "meeting.cancelled";
    const what =
      notice.count > 1
        ? `${notice.meeting.title} and ${String(notice.count - 1)} later Class Meeting${notice.count > 2 ? "s" : ""}`
        : notice.meeting.title;
    for (const r of recipients) {
      await this.notifications.notify(tx, {
        userId: r.userId,
        kind: notice.kind,
        title: `${course?.code ?? ""} ${cancelled ? "cancelled" : "moved"}: ${what}`,
        data: {
          offeringId: notice.offeringId,
          meetingId: notice.meeting.id,
          courseCode: course?.code ?? "",
          title: notice.meeting.title,
          count: notice.count,
          scheduledStart: notice.meeting.start.toISOString(),
          scheduledEnd: notice.meeting.end.toISOString(),
          roomName: notice.meeting.roomName,
          reason: notice.reason ?? null,
          timeZone: r.timezone ?? institution.timezone,
          institutionZone: institution.timezone,
        },
        email: true,
      });
    }
    return recipients.length;
  }

  /** The Room's name, for notices. */
  async roomName(db: Database, roomId: string | null): Promise<string | null> {
    if (roomId === null) return null;
    const r = schema.rooms;
    const [room] = await db.select({ name: r.name }).from(r).where(eq(r.id, roomId));
    return room?.name ?? null;
  }
}

function dedupe(conflicts: ScheduleConflict[]): ScheduleConflict[] {
  return [...new Map(conflicts.map((c) => [c.meetingId, c])).values()];
}
