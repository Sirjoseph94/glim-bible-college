import type {
  ClassMeeting,
  ClassMeetingSeries,
  ScheduleConflict,
  ScheduleWarning,
} from "@glim/contracts";
import { Db, PG, pgError } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import {
  addDays,
  fromRrule,
  toRrule,
  weeklyOccurrences,
  type SeriesRow,
  type Weekday,
  type WeeklyRule,
} from "@glim/modules/scheduling";
import { domainError, err, ok, type DomainResult } from "@glim/shared";
import { toLocalDate, zonedToInstant } from "@glim/shared/time";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { ClassMeetingsService } from "./class-meetings.service";
import {
  invalid,
  MeetingWriter,
  normaliseLink,
  outsideOffering,
  type MeetingSlot,
} from "./meeting-writer";

/** Occurrences are generated this far ahead, and the horizon moves on daily (§11.9). */
export const HORIZON_DAYS = 56;

export interface NewSeriesInput {
  titleTemplate: string;
  weekdays: Weekday[];
  interval?: number | undefined;
  startsOn: string;
  untilOn?: string | null | undefined;
  startTime: string;
  durationMinutes: number;
  roomId?: string | null | undefined;
  onlineLink?: string | null | undefined;
  overrideConflicts?: boolean | undefined;
  reason?: string | undefined;
}

interface PlannedOccurrence extends MeetingSlot {
  date: string;
  n: number;
}

const titleFor = (template: string, n: number) => template.replaceAll("{n}", String(n));

/**
 * Weekly Class Meeting series (TRD §11.9): the series row belongs to scheduling, its meetings to
 * class-meeting. Creation is all-or-nothing: any clash rejects the series and lists the dates.
 * A daily job then generates occurrences up to eight weeks ahead.
 */
@Injectable()
export class SeriesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MeetingWriter) private readonly writer: MeetingWriter,
    @Inject(ClassMeetingsService) private readonly meetings: ClassMeetingsService,
  ) {}

  async create(
    offeringId: string,
    input: NewSeriesInput,
    actor: AuditActor & { userId: string },
  ): Promise<
    DomainResult<{
      series: ClassMeetingSeries;
      meetings: ClassMeeting[];
      warnings: ScheduleWarning[];
    }>
  > {
    const link = normaliseLink(input.onlineLink);
    if (!link.ok) return link;
    const override = await this.writer.override(input, actor.userId);
    if (!override.ok) return override;
    const roomId = input.roomId ?? null;
    const problem =
      (await this.writer.checkOffering(offeringId)) ?? (await this.writer.checkRoom(roomId));
    if (problem !== null) return err(problem);

    const zone = await this.writer.zone();
    const now = this.writer.now();
    const today = toLocalDate(now, zone);
    // A series stays within its offering's dates, ending on its last day at the latest (ADR-0005).
    const offering = await this.writer.offeringDates(offeringId);
    if (offering === null) return err(domainError("NOT_FOUND", "Not found."));
    if (
      input.startsOn < offering.startsOn ||
      input.startsOn > offering.endsOn ||
      (input.untilOn != null && input.untilOn > offering.endsOn)
    )
      return err(outsideOffering(offering));
    const untilOn = input.untilOn ?? offering.endsOn;
    if (input.startsOn < today) return err(invalid("startsOn", "Start the series today or later."));
    if (untilOn < input.startsOn)
      return err(invalid("untilOn", "The series must end on or after its first day."));
    const rule: WeeklyRule = {
      startsOn: input.startsOn,
      untilOn,
      weekdays: input.weekdays,
      interval: input.interval ?? 1,
    };
    if (weeklyOccurrences(rule, untilOn).length === 0)
      return err(invalid("weekdays", "None of those weekdays fall between the start and end."));
    const through = minDate(addDays(today, HORIZON_DAYS), untilOn);
    const planned = this.occurrences(rule, through, input.startTime, input.durationMinutes, zone);

    // Every clash, by date: the whole series is refused if any date clashes.
    const clashes: { date: string; conflicts: ScheduleConflict[]; room: boolean }[] = [];
    for (const occurrence of planned) {
      const blocked = await this.writer.conflicts(
        offeringId,
        [occurrence],
        roomId,
        override.value === null,
      );
      if (blocked !== null)
        clashes.push({
          date: occurrence.date,
          conflicts: blocked.conflicts ?? [],
          room: blocked.code === "ROOM_CONFLICT",
        });
    }
    if (clashes.length > 0) {
      const dates = clashes.map((c) => dateLabel(c.date)).join("; ");
      return err(
        domainError(
          clashes.some((c) => c.room) ? "ROOM_CONFLICT" : "LECTURER_SCHEDULE_CONFLICT",
          `The series clashes with other Class Meetings on: ${dates}.`,
          { conflicts: clashes.flatMap((c) => c.conflicts) },
        ),
      );
    }

    let created: { series: SeriesRow; meetingIds: string[] };
    try {
      created = await this.db.withTx(async (tx) => {
        const series = await this.writer.scheduling.insertSeries(tx.db, {
          courseOfferingId: offeringId,
          titleTemplate: input.titleTemplate,
          rrule: toRrule(rule),
          timezone: zone,
          startsOn: input.startsOn,
          untilOn,
          startTime: input.startTime,
          durationMinutes: input.durationMinutes,
          roomId,
          onlineLink: link.value ?? null,
          generatedThrough: through,
          status: through >= untilOn ? "ENDED" : "ACTIVE",
          createdBy: actor.userId,
        });
        const meetingIds: string[] = [];
        for (const occurrence of planned) {
          const meeting = await this.writer.insert(
            tx,
            {
              offeringId,
              title: titleFor(input.titleTemplate, occurrence.n),
              description: null,
              start: occurrence.start,
              end: occurrence.end,
              roomId,
              onlineLink: link.value ?? null,
              recordingMode: "AUTO",
              seriesId: series.id,
              occurrenceDate: occurrence.date,
            },
            override.value,
            actor,
          );
          meetingIds.push(meeting.id);
        }
        await this.audit.record(tx.db, actor, {
          action: "meeting.series.created",
          resourceType: "class-meeting-series",
          resourceId: series.id,
          metadata: {
            offeringId,
            rrule: series.rrule,
            startTime: input.startTime,
            durationMinutes: input.durationMinutes,
            roomId,
            generated: meetingIds.length,
            ...(override.value === null
              ? {}
              : { overrideConflicts: true, reason: override.value.reason }),
          },
        });
        return { series, meetingIds };
      });
    } catch (error) {
      const raced = await this.writer.fromConstraint(error, offeringId, planned, roomId);
      if (raced === null) throw error;
      return err(raced);
    }
    const warnings = await this.meetings.clashes(
      offeringId,
      planned.map((p, i) => ({ ...p, meetingId: created.meetingIds[i] ?? "" })),
    );
    return ok({
      series: seriesView(created.series),
      meetings: await this.meetings.viewAll(created.meetingIds, actor.userId),
      warnings,
    });
  }

  /**
   * The daily `class-meeting.series-extend` job: generates each active series' occurrences up to
   * the horizon. An occurrence that would clash is skipped and audited (no one is there to choose
   * another time); the rest go ahead. Safe to rerun: `(series_id, occurrence_date)` is unique.
   */
  async extend(): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;
    for (const series of await this.writer.scheduling.activeSeries()) {
      const outcome = await this.extendOne(series);
      created += outcome.created;
      skipped += outcome.skipped;
    }
    this.logger.info({ created, skipped }, "series extended");
    return { created, skipped };
  }

  private async extendOne(series: SeriesRow): Promise<{ created: number; skipped: number }> {
    const rule = fromRrule(series.rrule, series.startsOn);
    const now = this.writer.now();
    const through = minDate(
      addDays(toLocalDate(now, series.timezone), HORIZON_DAYS),
      series.untilOn,
    );
    const done = series.generatedThrough;
    let created = 0;
    let skipped = 0;
    if (rule !== null && series.createdBy !== null && (done === null || through > done)) {
      const actor = { userId: series.createdBy, type: "JOB" as const };
      const due = this.occurrences(
        rule,
        through,
        series.startTime.slice(0, 5),
        series.durationMinutes,
        series.timezone,
      ).filter((o) => done === null || o.date > done);
      for (const occurrence of due) {
        const blocked = await this.writer.conflicts(
          series.courseOfferingId,
          [occurrence],
          series.roomId,
          true,
        );
        if (blocked !== null) {
          skipped++;
          await this.skip(series, occurrence.date, blocked.code);
          continue;
        }
        try {
          await this.db.withTx((tx) =>
            this.writer.insert(
              tx,
              {
                offeringId: series.courseOfferingId,
                title: titleFor(series.titleTemplate, occurrence.n),
                description: null,
                start: occurrence.start,
                end: occurrence.end,
                roomId: series.roomId,
                onlineLink: series.onlineLink,
                recordingMode: "AUTO",
                seriesId: series.id,
                occurrenceDate: occurrence.date,
              },
              null,
              actor,
            ),
          );
          created++;
        } catch (error) {
          const code = pgError(error)?.code;
          // Already generated (a rerun), or a clash that slipped in since the check.
          if (code === PG.UNIQUE_VIOLATION) continue;
          if (code !== PG.EXCLUSION_VIOLATION) throw error;
          skipped++;
          await this.skip(series, occurrence.date, "CONFLICT");
        }
      }
    }
    const ended = series.untilOn !== null && through >= series.untilOn;
    await this.db.withTx(({ db }) =>
      this.writer.scheduling.updateSeries(db, series.id, {
        generatedThrough: done !== null && done > through ? done : through,
        ...(ended ? { status: "ENDED" } : {}),
      }),
    );
    return { created, skipped };
  }

  private async skip(series: SeriesRow, date: string, code: string): Promise<void> {
    await this.db.withTx(({ db }) =>
      this.audit.record(
        db,
        { userId: null, type: "JOB" },
        {
          action: "meeting.series.occurrence-skipped",
          resourceType: "class-meeting-series",
          resourceId: series.id,
          metadata: { date, code },
        },
      ),
    );
  }

  /** Occurrence dates with their instants in the zone, keeping only those still to come. */
  private occurrences(
    rule: WeeklyRule,
    through: string,
    startTime: string,
    durationMinutes: number,
    zone: string,
  ): PlannedOccurrence[] {
    const now = this.writer.now().getTime();
    return weeklyOccurrences(rule, through)
      .map((o) => {
        const start = new Date(zonedToInstant(o.date, startTime, zone));
        return { ...o, start, end: new Date(start.getTime() + durationMinutes * 60_000) };
      })
      .filter((o) => o.start.getTime() > now);
  }
}

/** A calendar date for people, e.g. "Mon 7 Sept 2080". */
function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

function minDate(a: string, b: string | null): string {
  return b !== null && b < a ? b : a;
}

function seriesView(row: SeriesRow): ClassMeetingSeries {
  return {
    id: row.id,
    courseOfferingId: row.courseOfferingId,
    titleTemplate: row.titleTemplate,
    rrule: row.rrule,
    timezone: row.timezone,
    startsOn: row.startsOn,
    untilOn: row.untilOn,
    startTime: row.startTime.slice(0, 5),
    durationMinutes: row.durationMinutes,
    roomId: row.roomId,
    generatedThrough: row.generatedThrough,
    status: row.status as ClassMeetingSeries["status"],
  };
}
