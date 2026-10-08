import type { ClassMeeting, ScheduleWarning } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { AuthorizationService } from "@glim/modules/authorization";
import { addDays } from "@glim/modules/scheduling";
import { definedFields, domainError, err, ok, type DomainResult } from "@glim/shared";
import { toLocalDate, zonedToInstant } from "@glim/shared/time";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import {
  checkTimes,
  invalid,
  MeetingWriter,
  normaliseLink,
  notFound,
  type MeetingRow,
  type MeetingSlot,
  type RecordingMode,
} from "./meeting-writer";

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

export type ChangeScope = "THIS_ONLY" | "ALL_FUTURE";

export interface ClassMeetingChange {
  title?: string | undefined;
  description?: string | null | undefined;
  scheduledStart?: string | undefined;
  scheduledEnd?: string | undefined;
  roomId?: string | null | undefined;
  onlineLink?: string | null | undefined;
  recordingMode?: RecordingMode | undefined;
  scope?: ChangeScope | undefined;
  overrideConflicts?: boolean | undefined;
  reason?: string | undefined;
}

type Actor = AuditActor & { userId: string };

/** `/me/schedule` defaults to the next two weeks. */
const DEFAULT_WINDOW_DAYS = 14;
const UPCOMING = ["SCHEDULED", "OPEN"];

const stale = () =>
  err(
    domainError(
      "VERSION_MISMATCH",
      "Someone else changed this Class Meeting. Reload and try again.",
    ),
  );

/** A meeting's new place in time and space, worked out before the transaction. */
interface Plan {
  row: MeetingRow;
  start: Date;
  end: Date;
}

/**
 * Class Meetings (owner: class-meeting, TRD §11; v1 spec: the Lecturer pastes the online link and
 * meetings are created ready, with no provider). Scheduling's conflict rules (§9.5) run before
 * each write; the exclusion constraints are the final word.
 */
@Injectable()
export class ClassMeetingsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(MeetingWriter) private readonly writer: MeetingWriter,
  ) {}

  /**
   * Schedules a Class Meeting (§11.6, without provisioning). A busy Lecturer is
   * `LECTURER_SCHEDULE_CONFLICT` unless an Academic Admin overrides it with a reason; a booked
   * Room is `ROOM_CONFLICT`, with no override. Students with another meeting then are a warning.
   */
  async create(
    offeringId: string,
    input: NewClassMeeting,
    actor: Actor,
  ): Promise<DomainResult<{ meeting: ClassMeeting; warnings: ScheduleWarning[] }>> {
    const start = new Date(input.scheduledStart);
    const end = new Date(input.scheduledEnd);
    const badTimes = checkTimes(start, end, this.writer.now());
    if (badTimes !== null) return err(badTimes);
    const link = normaliseLink(input.onlineLink);
    if (!link.ok) return link;
    const override = await this.writer.override(input, actor.userId);
    if (!override.ok) return override;
    const roomId = input.roomId ?? null;
    const problem =
      (await this.writer.checkOffering(offeringId)) ??
      (await this.writer.checkRoom(roomId)) ??
      (await this.writer.conflicts(offeringId, [{ start, end }], roomId, override.value === null));
    if (problem !== null) return err(problem);

    let created: MeetingRow;
    try {
      created = await this.db.withTx((tx) =>
        this.writer.insert(
          tx,
          {
            offeringId,
            title: input.title,
            description: input.description ?? null,
            start,
            end,
            roomId,
            onlineLink: link.value ?? null,
            recordingMode: input.recordingMode ?? "AUTO",
          },
          override.value,
          actor,
        ),
      );
    } catch (error) {
      const raced = await this.writer.fromConstraint(error, offeringId, [{ start, end }], roomId);
      if (raced === null) throw error;
      return err(raced);
    }
    const warnings = await this.clashes(offeringId, [{ start, end, meetingId: created.id }]);
    const meeting = await this.view(created.id, true);
    if (meeting === null) throw new Error("created meeting vanished");
    return ok({ meeting, warnings });
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

  /**
   * Changes a meeting, or it and its series' later ones (§11.9). A new time or Room is a
   * reschedule: only for an upcoming SCHEDULED/OPEN meeting, conflict-checked like a new one,
   * and enrolled students are told. Once a meeting has started only its title and description
   * change; the online link and recording mode can change until it has ended.
   */
  async update(
    id: string,
    expectedVersion: number,
    change: ClassMeetingChange,
    actor: Actor,
  ): Promise<
    DomainResult<{ meeting: ClassMeeting; warnings: ScheduleWarning[]; changed: number }>
  > {
    const link = normaliseLink(change.onlineLink);
    if (!link.ok) return link;
    const override = await this.writer.override(change, actor.userId);
    if (!override.ok) return override;
    const current = await this.row(id);
    if (current === null) return notFound();
    if (current.version !== expectedVersion) return stale();

    const now = this.writer.now();
    const scope = change.scope ?? "THIS_ONLY";
    if (scope === "ALL_FUTURE" && current.seriesId === null)
      return err(invalid("scope", "This Class Meeting isn't part of a series."));
    const moves =
      change.scheduledStart !== undefined ||
      change.scheduledEnd !== undefined ||
      change.roomId !== undefined;
    const settings = change.onlineLink !== undefined || change.recordingMode !== undefined;
    if (current.state === "CANCELLED")
      return err(domainError("MEETING_STATE_INVALID", "This Class Meeting was cancelled."));
    if (moves && (!UPCOMING.includes(current.state) || current.scheduledStart <= now))
      return err(
        domainError(
          "MEETING_STATE_INVALID",
          "Only an upcoming Class Meeting can move. Once it has started, only its title and description can change.",
        ),
      );
    if (settings && !["SCHEDULED", "OPEN", "LIVE"].includes(current.state))
      return err(
        domainError(
          "MEETING_STATE_INVALID",
          "This Class Meeting has ended; only its title and description can change.",
        ),
      );

    // The new time for this meeting: a new start alone keeps the length.
    const start =
      change.scheduledStart === undefined
        ? current.scheduledStart
        : new Date(change.scheduledStart);
    const end =
      change.scheduledEnd !== undefined
        ? new Date(change.scheduledEnd)
        : new Date(
            start.getTime() + (current.scheduledEnd.getTime() - current.scheduledStart.getTime()),
          );
    const timesChange =
      start.getTime() !== current.scheduledStart.getTime() ||
      end.getTime() !== current.scheduledEnd.getTime();
    if (timesChange) {
      const bad = checkTimes(start, end, now);
      if (bad !== null) return err(bad);
    }
    const roomId = change.roomId === undefined ? current.roomId : change.roomId;
    if (change.roomId !== undefined) {
      const bad = await this.writer.checkRoom(roomId);
      if (bad !== null) return err(bad);
    }

    const plans = await this.plan(current, scope, { start, end, timesChange });
    if (!plans.ok) return plans;
    const slots: MeetingSlot[] = plans.value.map((p) => ({
      start: p.start,
      end: p.end,
      meetingId: p.row.id,
    }));
    // The effective Room is checked whenever the time or the Room changes; the Lecturers only
    // when the time does.
    if (moves) {
      const blocked = await this.writer.conflicts(
        current.courseOfferingId,
        slots,
        roomId,
        override.value === null && timesChange,
      );
      if (blocked !== null) return err(blocked);
    }

    const fields = definedFields({
      title: change.title,
      description: change.description,
      onlineLink: link.value,
      recordingMode: change.recordingMode,
    });
    let result: DomainResult<null>;
    try {
      result = await this.db.withTxResult(async (tx) => {
        const { db, boss } = tx;
        const [locked] = await db
          .select({ version: schema.classMeetings.version })
          .from(schema.classMeetings)
          .where(eq(schema.classMeetings.id, id))
          .for("update");
        if (locked?.version !== expectedVersion) return stale();
        const m = schema.classMeetings;
        for (const plan of plans.value) {
          await db
            .update(m)
            .set({
              ...fields,
              ...(moves ? { scheduledStart: plan.start, scheduledEnd: plan.end, roomId } : {}),
              ...(scope === "THIS_ONLY" && current.seriesId !== null
                ? { seriesException: true }
                : {}),
              updatedAt: now,
              version: sql`${m.version} + 1`,
            })
            .where(eq(m.id, plan.row.id));
          if (timesChange)
            await this.writer.scheduling.moveSlots(
              db,
              plan.row.id,
              plan.start,
              plan.end,
              override.value,
            );
        }
        if (scope === "ALL_FUTURE" && current.seriesId !== null)
          await this.writer.scheduling.updateSeries(
            db,
            current.seriesId,
            definedFields({
              titleTemplate: change.title,
              onlineLink: link.value,
              roomId: change.roomId,
              ...(timesChange
                ? {
                    startTime: localTime(start, current.timezone),
                    durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
                  }
                : {}),
            }),
          );
        await this.audit.record(db, actor, {
          action: moves ? "meeting.class-meeting.rescheduled" : "meeting.class-meeting.updated",
          resourceType: "class-meeting",
          resourceId: id,
          metadata: {
            fields: [...Object.keys(fields), ...(moves ? ["time", "room"] : [])],
            scope,
            changed: plans.value.length,
            ...(moves
              ? {
                  from: current.scheduledStart.toISOString(),
                  to: start.toISOString(),
                  roomId,
                }
              : {}),
            ...(override.value === null
              ? {}
              : { overrideConflicts: true, reason: override.value.reason }),
          },
        });
        if (moves) {
          await boss.publish(
            "meeting.rescheduled",
            {
              meetingIds: plans.value.map((p) => p.row.id),
              offeringId: current.courseOfferingId,
            },
            { occurredAt: now, actorUserId: actor.userId },
          );
          await this.writer.notifyEnrolled(tx, {
            kind: "meeting.rescheduled",
            offeringId: current.courseOfferingId,
            meeting: {
              id,
              title: change.title ?? current.title,
              start,
              end,
              roomName: await this.writer.roomName(db, roomId),
            },
            count: plans.value.length,
          });
        }
        return ok(null);
      });
    } catch (error) {
      const raced = await this.writer.fromConstraint(
        error,
        current.courseOfferingId,
        slots,
        roomId,
      );
      if (raced === null) throw error;
      return err(raced);
    }
    if (!result.ok) return result;
    const warnings = timesChange ? await this.clashes(current.courseOfferingId, slots) : [];
    const meeting = await this.view(id, true);
    return meeting === null ? notFound() : ok({ meeting, warnings, changed: plans.value.length });
  }

  /**
   * Cancels a meeting, or it and its series' later ones, with a reason (§11.9). Only upcoming
   * (SCHEDULED/OPEN) meetings; a LIVE one is `MEETING_IN_PROGRESS`. Frees the Room and the
   * Lecturers, and tells enrolled students. Cancelling ALL_FUTURE ends the series.
   */
  async cancel(
    id: string,
    input: { reason: string; scope?: ChangeScope | undefined },
    actor: Actor,
  ): Promise<DomainResult<{ meeting: ClassMeeting; cancelled: number }>> {
    const scope = input.scope ?? "THIS_ONLY";
    const result = await this.db.withTxResult(async (tx) => {
      const { db, boss } = tx;
      const m = schema.classMeetings;
      const [current] = await db.select().from(m).where(eq(m.id, id)).for("update");
      if (current === undefined) return notFound();
      if (current.state === "LIVE")
        return err(
          domainError("MEETING_IN_PROGRESS", "This Class Meeting is live; end it instead."),
        );
      if (!UPCOMING.includes(current.state))
        return err(
          domainError(
            "MEETING_STATE_INVALID",
            `This Class Meeting is ${current.state.toLowerCase().replace("_", " ")}; it can't be cancelled.`,
          ),
        );
      if (scope === "ALL_FUTURE" && current.seriesId === null)
        return err(invalid("scope", "This Class Meeting isn't part of a series."));
      const now = this.writer.now();
      const targets =
        scope === "THIS_ONLY" || current.seriesId === null
          ? [current.id]
          : (
              await db
                .select({ id: m.id })
                .from(m)
                .where(
                  and(
                    eq(m.seriesId, current.seriesId),
                    gte(m.scheduledStart, current.scheduledStart),
                    inArray(m.state, UPCOMING),
                  ),
                )
            ).map((r) => r.id);
      await db
        .update(m)
        .set({
          state: "CANCELLED",
          cancelledAt: now,
          cancelReason: input.reason,
          updatedAt: now,
          version: sql`${m.version} + 1`,
        })
        .where(inArray(m.id, targets));
      await this.writer.scheduling.freeSlots(db, targets);
      if (scope === "ALL_FUTURE" && current.seriesId !== null)
        await this.writer.scheduling.updateSeries(db, current.seriesId, {
          status: "ENDED",
          untilOn: addDays(
            current.occurrenceDate ?? toLocalDate(current.scheduledStart, current.timezone),
            -1,
          ),
        });
      await this.audit.record(db, actor, {
        action: "meeting.class-meeting.cancelled",
        resourceType: "class-meeting",
        resourceId: id,
        metadata: { reason: input.reason, scope, cancelled: targets.length },
      });
      await boss.publish(
        "meeting.cancelled",
        { meetingIds: targets, offeringId: current.courseOfferingId },
        { occurredAt: now, actorUserId: actor.userId },
      );
      await this.writer.notifyEnrolled(tx, {
        kind: "meeting.cancelled",
        offeringId: current.courseOfferingId,
        meeting: {
          id,
          title: current.title,
          start: current.scheduledStart,
          end: current.scheduledEnd,
          roomName: await this.writer.roomName(db, current.roomId),
        },
        count: targets.length,
        reason: input.reason,
      });
      return ok(targets.length);
    });
    if (!result.ok) return result;
    const meeting = await this.view(id, true);
    return meeting === null ? notFound() : ok({ meeting, cancelled: result.value });
  }

  /**
   * The viewer's meetings between two instants: as a student, on offerings they're ENROLLED on;
   * as a Lecturer, on offerings they're assigned to (§7.2, via `v_offering_access`).
   */
  async schedule(
    userId: string,
    window: { from?: string | undefined; to?: string | undefined },
  ): Promise<(ClassMeeting & { as: "STUDENT" | "LECTURER" })[]> {
    const from = window.from === undefined ? this.writer.now() : new Date(window.from);
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
    const row = await this.row(id);
    return row?.courseOfferingId ?? null;
  }

  /** Meetings in their full form (with links), for callers that manage them. */
  viewAll(ids: string[]): Promise<ClassMeeting[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.query(inArray(schema.classMeetings.id, ids), true);
  }

  // ---- helpers ----

  /** Student clashes across the given times, as at most one warning. */
  async clashes(offeringId: string, slots: MeetingSlot[]): Promise<ScheduleWarning[]> {
    let count = 0;
    const sample = new Set<string>();
    for (const slot of slots) {
      const w = await this.writer.scheduling.studentClash({ offeringId, ...slot });
      if (w === null) continue;
      count = Math.max(count, w.count);
      for (const meetingId of w.sampleMeetingIds) if (sample.size < 5) sample.add(meetingId);
    }
    return count === 0
      ? []
      : [{ code: "STUDENT_SCHEDULE_CLASH", count, sampleMeetingIds: [...sample] }];
  }

  /**
   * The meetings a change applies to and where each goes. For ALL_FUTURE, the series' upcoming
   * occurrences from this one on (except those changed on their own), each keeping its own date;
   * a new time moves them all to the new time of day, so the date itself can't change.
   */
  private async plan(
    current: MeetingRow,
    scope: ChangeScope,
    time: { start: Date; end: Date; timesChange: boolean },
  ): Promise<DomainResult<Plan[]>> {
    if (scope === "THIS_ONLY" || current.seriesId === null)
      return ok([{ row: current, start: time.start, end: time.end }]);
    const zone = current.timezone;
    const date = current.occurrenceDate ?? toLocalDate(current.scheduledStart, zone);
    if (time.timesChange && toLocalDate(time.start, zone) !== date)
      return err(
        invalid(
          "scheduledStart",
          "A change to this and later Class Meetings can move the time of day, not the date. Cancel the rest of the series and start a new one to change the day.",
        ),
      );
    const m = schema.classMeetings;
    const rows = await this.db.read
      .select()
      .from(m)
      .where(
        and(
          eq(m.seriesId, current.seriesId),
          gte(m.scheduledStart, current.scheduledStart),
          inArray(m.state, UPCOMING),
          or(eq(m.id, current.id), eq(m.seriesException, false)),
        ),
      )
      .orderBy(asc(m.scheduledStart));
    const newTime = localTime(time.start, zone);
    const minutes = (time.end.getTime() - time.start.getTime()) / 60_000;
    return ok(
      rows.map((row) => {
        if (!time.timesChange) return { row, start: row.scheduledStart, end: row.scheduledEnd };
        const start = new Date(
          zonedToInstant(
            row.occurrenceDate ?? toLocalDate(row.scheduledStart, zone),
            newTime,
            zone,
          ),
        );
        return { row, start, end: new Date(start.getTime() + minutes * 60_000) };
      }),
    );
  }

  private async row(id: string, db: Database = this.db.read): Promise<MeetingRow | null> {
    const m = schema.classMeetings;
    const [row] = await db.select().from(m).where(eq(m.id, id));
    return row ?? null;
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
  ): Promise<ClassMeeting[]> {
    const m = schema.classMeetings;
    const c = schema.courses;
    const r = schema.rooms;
    const rows = await this.db.read
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

/** The wall-clock time (HH:mm) of an instant in a zone. */
export function localTime(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}
