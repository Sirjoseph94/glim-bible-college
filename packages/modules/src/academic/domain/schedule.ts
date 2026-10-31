/** One offering's dates, as ISO calendar dates (YYYY-MM-DD). */
export interface ScheduledDates {
  startsOn: string;
  endsOn: string;
  examOn: string;
}

const DAY_MS = 86_400_000;

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Dates for `count` courses taught one after another from `startsOn` (ADR-0005): each lasts
 * `weeks` weeks, its exam is on its last day, and the next starts the day after.
 */
export function layOutSchedule(startsOn: string, weeks: number, count: number): ScheduledDates[] {
  const length = weeks * 7;
  return Array.from({ length: count }, (_, i) => {
    const start = addDays(startsOn, i * length);
    const end = addDays(start, length - 1);
    return { startsOn: start, endsOn: end, examOn: end };
  });
}
