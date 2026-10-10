import type { ClassMeeting } from "@glim/contracts";

export type ScheduledMeeting = ClassMeeting & { as: "STUDENT" | "LECTURER" };

export interface TodayPlan {
  /** Open to join or live now. */
  happeningNow: ScheduledMeeting[];
  /** Still to come today (or cancelled today), in time order. */
  laterToday: ScheduledMeeting[];
  /** When nothing is on today: the next class on a later day. */
  next: ScheduledMeeting | null;
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
 * A student's day, most urgent first (handoff §1.3 "Now first", §11.2): classes to join now,
 * then the rest of today, and otherwise the next class. "Today" is the viewer's own day.
 */
export function planToday(meetings: ScheduledMeeting[], now: Date, zone: string): TodayPlan {
  const today = dayIn(now, zone);
  const mine = meetings
    .filter((m) => m.as === "STUDENT")
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  const happeningNow = mine.filter((m) => m.state === "OPEN" || m.state === "LIVE");
  const laterToday = mine.filter(
    (m) =>
      (m.state === "SCHEDULED" || m.state === "CANCELLED") &&
      dayIn(new Date(m.scheduledStart), zone) === today &&
      new Date(m.scheduledEnd) > now,
  );
  const next =
    happeningNow.length === 0 && laterToday.length === 0
      ? (mine.find(
          (m) => m.state === "SCHEDULED" && dayIn(new Date(m.scheduledStart), zone) > today,
        ) ?? null)
      : null;
  return { happeningNow, laterToday, next };
}
