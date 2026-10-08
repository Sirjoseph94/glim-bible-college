/**
 * Weekly recurrence for Class Meeting series (TRD §11.9). v1 series are weekly, so instead of a
 * general RRULE engine this expands `FREQ=WEEKLY;INTERVAL=n;BYDAY=…[;UNTIL=…]` over calendar
 * dates; each date's start instant is then read in the institution's zone, so daylight-saving
 * changes keep the wall-clock time.
 */

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface WeeklyRule {
  /** The first date the series may fall on (YYYY-MM-DD). */
  startsOn: string;
  /** The last date it may fall on, if any. */
  untilOn: string | null;
  weekdays: readonly Weekday[];
  /** Every `interval` weeks, counted from the week (Monday to Sunday) containing `startsOn`. */
  interval: number;
}

export interface Occurrence {
  date: string;
  /** 1-based position in the whole series, stable however far it has been generated. */
  n: number;
}

const DAY = 86_400_000;
const toDay = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;
const fromDay = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
/** Monday = 0 … Sunday = 6. */
const weekdayIndex = (day: number) => (new Date(day * DAY).getUTCDay() + 6) % 7;

/** The rule in RFC 5545 form, as stored on the series. */
export function toRrule(rule: WeeklyRule): string {
  const parts = [
    "FREQ=WEEKLY",
    `INTERVAL=${String(rule.interval)}`,
    `BYDAY=${[...rule.weekdays].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)).join(",")}`,
  ];
  if (rule.untilOn !== null) parts.push(`UNTIL=${rule.untilOn.replaceAll("-", "")}`);
  return parts.join(";");
}

/** Reads a rule written by `toRrule` back; null for anything else. */
export function fromRrule(rrule: string, startsOn: string): WeeklyRule | null {
  const fields = new Map(rrule.split(";").map((p) => p.split("=") as [string, string | undefined]));
  if (fields.get("FREQ") !== "WEEKLY") return null;
  const interval = Number(fields.get("INTERVAL") ?? "1");
  const weekdays = (fields.get("BYDAY") ?? "").split(",").filter(Boolean);
  if (!Number.isInteger(interval) || interval < 1) return null;
  if (weekdays.length === 0 || !weekdays.every((d) => (WEEKDAYS as readonly string[]).includes(d)))
    return null;
  const until = fields.get("UNTIL");
  return {
    startsOn,
    untilOn:
      until === undefined ? null : `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`,
    weekdays: weekdays as Weekday[],
    interval,
  };
}

/** Every occurrence date from `startsOn` through `through` (inclusive), in order. */
export function weeklyOccurrences(rule: WeeklyRule, through: string): Occurrence[] {
  const first = toDay(rule.startsOn);
  const last = Math.min(toDay(through), rule.untilOn === null ? Infinity : toDay(rule.untilOn));
  const weekStart = first - weekdayIndex(first);
  const wanted = new Set(rule.weekdays.map((d) => WEEKDAYS.indexOf(d)));
  const out: Occurrence[] = [];
  for (let day = first; day <= last; day++) {
    const week = Math.floor((day - weekStart) / 7);
    if (week % rule.interval !== 0 || !wanted.has(weekdayIndex(day))) continue;
    out.push({ date: fromDay(day), n: out.length + 1 });
  }
  return out;
}

/** Adds days to a calendar date. */
export function addDays(date: string, days: number): string {
  return fromDay(toDay(date) + days);
}
