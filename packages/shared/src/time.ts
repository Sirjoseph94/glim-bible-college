import { DateTime, IANAZone } from "luxon";

export const DEFAULT_INSTITUTION_ZONE = "Africa/Lagos";

export interface DualTimeOptions {
  viewerZone: string;
  institutionZone?: string;
  withDate?: boolean;
}

/**
 * Renders an instant in the viewer's timezone, with the institution's time alongside when the
 * two differ at that instant (TRD §5.1), e.g. "14:00 London (15:00 Lagos)".
 */
export function formatDualTime(instant: Date | string, options: DualTimeOptions): string {
  const institutionZone = options.institutionZone ?? DEFAULT_INSTITUTION_ZONE;
  const at = toDateTime(instant);
  const viewer = at.setZone(options.viewerZone);
  const institution = at.setZone(institutionZone);
  const datePrefix = options.withDate ? `${viewer.toFormat("ccc d LLL yyyy")}, ` : "";

  if (viewer.offset === institution.offset) {
    return `${datePrefix}${viewer.toFormat("HH:mm")}`;
  }

  const sameDay = viewer.toISODate() === institution.toISODate();
  const institutionPart = `${sameDay ? "" : `${institution.toFormat("ccc d LLL")}, `}${institution.toFormat("HH:mm")} ${zoneLabel(institutionZone)}`;
  return `${datePrefix}${viewer.toFormat("HH:mm")} ${zoneLabel(options.viewerZone)} (${institutionPart})`;
}

/** The city part of an IANA zone name, e.g. "America/New_York" → "New York". */
export function zoneLabel(zone: string): string {
  const city = zone.split("/").pop() ?? zone;
  return city.replaceAll("_", " ");
}

export function isValidTimeZone(zone: string): boolean {
  return zone.length > 0 && IANAZone.isValidZone(zone);
}

/** The calendar date (YYYY-MM-DD) of an instant in a zone. */
export function toLocalDate(instant: Date | string, zone: string): string {
  const date = toDateTime(instant).setZone(zone).toISODate();
  if (date === null) throw new RangeError(`Invalid instant or zone: ${zone}`);
  return date;
}

function toDateTime(instant: Date | string): DateTime {
  const dt = instant instanceof Date ? DateTime.fromJSDate(instant) : DateTime.fromISO(instant);
  if (!dt.isValid) throw new RangeError(`Invalid instant: ${String(instant)}`);
  return dt;
}
