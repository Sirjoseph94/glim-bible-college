/**
 * Time-zone display (TRD §5.1), built on Intl so the browser bundle needs no date library.
 * Instants are shown in the viewer's zone, with the institution's alongside when they differ.
 */

export const DEFAULT_INSTITUTION_ZONE = "Africa/Lagos";

export interface DualTimeOptions {
  viewerZone: string;
  institutionZone?: string;
  withDate?: boolean;
}

interface WallClock {
  weekday: string;
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  isoDate: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(at: Date, zone: string): WallClock {
  let f = formatters.get(zone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(at)) p[part.type] = part.value;
  const isoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return {
    weekday: p.weekday ?? "",
    day: p.day ?? "",
    month: p.month ?? "",
    year: p.year ?? "",
    hour: p.hour ?? "",
    minute: p.minute ?? "",
    isoDate,
  };
}

/**
 * Renders an instant in the viewer's timezone, with the institution's time alongside when the
 * two read differently at that instant, e.g. "14:00 London (15:00 Lagos)".
 */
export function formatDualTime(instant: Date | string, options: DualTimeOptions): string {
  const institutionZone = options.institutionZone ?? DEFAULT_INSTITUTION_ZONE;
  const at = toDate(instant);
  const viewer = wallClock(at, options.viewerZone);
  const institution = wallClock(at, institutionZone);
  const time = (w: WallClock) => `${w.hour}:${w.minute}`;
  const datePrefix = options.withDate
    ? `${viewer.weekday} ${viewer.day} ${viewer.month} ${viewer.year}, `
    : "";

  const sameDay = viewer.isoDate === institution.isoDate;
  if (sameDay && time(viewer) === time(institution)) return `${datePrefix}${time(viewer)}`;

  const institutionPart = `${sameDay ? "" : `${institution.weekday} ${institution.day} ${institution.month}, `}${time(institution)} ${zoneLabel(institutionZone)}`;
  return `${datePrefix}${time(viewer)} ${zoneLabel(options.viewerZone)} (${institutionPart})`;
}

/** The city part of an IANA zone name, e.g. "America/New_York" → "New York". */
export function zoneLabel(zone: string): string {
  const city = zone.split("/").pop() ?? zone;
  return city.replaceAll("_", " ");
}

export function isValidTimeZone(zone: string): boolean {
  if (zone.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date (YYYY-MM-DD) of an instant in a zone. */
export function toLocalDate(instant: Date | string, zone: string): string {
  if (!isValidTimeZone(zone)) throw new RangeError(`Invalid zone: ${zone}`);
  return wallClock(toDate(instant), zone).isoDate;
}

function toDate(instant: Date | string): Date {
  const at = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(at.getTime())) throw new RangeError(`Invalid instant: ${String(instant)}`);
  return at;
}
