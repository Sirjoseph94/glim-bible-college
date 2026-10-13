import type { ClassMeeting } from "@glim/contracts";

export type ScheduledMeeting = ClassMeeting & { as: "STUDENT" | "LECTURER" };

export interface TodayPlan {
  /** Open to join or live now. */
  happeningNow: ScheduledMeeting[];
  /** Still to come today (or cancelled today), in time order. */
  laterToday: ScheduledMeeting[];
  /** When nothing is on today: the next class on a later day. */
  next: ScheduledMeeting | null;
  /** Classes on later days, in time order (a Lecturer's "Coming up", §11.7). */
  comingUp: ScheduledMeeting[];
}

/** The calendar day of an instant in a timezone, as YYYY-MM-DD. */
function dayIn(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * The day, most urgent first (handoff §1.3 "Now first", §11.2, §11.7): classes open or live now,
 * then the rest of today, and otherwise the next class. `as` picks the classes the person
 * attends (a student) or teaches (a Lecturer). "Today" is the viewer's own day.
 */
export function planToday(
  meetings: ScheduledMeeting[],
  now: Date,
  zone: string,
  as: ScheduledMeeting["as"] = "STUDENT",
): TodayPlan {
  const today = dayIn(now, zone);
  const mine = meetings
    .filter((m) => m.as === as)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  const happeningNow = mine.filter((m) => m.state === "OPEN" || m.state === "LIVE");
  const laterToday = mine.filter(
    (m) =>
      (m.state === "SCHEDULED" || m.state === "CANCELLED") &&
      dayIn(new Date(m.scheduledStart), zone) === today &&
      new Date(m.scheduledEnd) > now,
  );
  const comingUp = mine.filter(
    (m) => m.state === "SCHEDULED" && dayIn(new Date(m.scheduledStart), zone) > today,
  );
  const next = happeningNow.length === 0 && laterToday.length === 0 ? (comingUp[0] ?? null) : null;
  return { happeningNow, laterToday, next, comingUp };
}

/** One calendar day of a schedule, in the viewer's zone. */
export interface ScheduleDay {
  /** YYYY-MM-DD in the viewer's zone. */
  day: string;
  meetings: ScheduledMeeting[];
}

/** Classes grouped by the viewer's calendar day, days and classes in time order (§11.11). */
export function byDay(meetings: ScheduledMeeting[], zone: string): ScheduleDay[] {
  const days = new Map<string, ScheduledMeeting[]>();
  for (const m of [...meetings].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))) {
    const day = dayIn(new Date(m.scheduledStart), zone);
    days.set(day, [...(days.get(day) ?? []), m]);
  }
  return [...days].map(([day, list]) => ({ day, meetings: list }));
}
