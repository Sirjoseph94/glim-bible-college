import { formatDualTime } from "@glim/shared/time";
import { useQuery } from "@tanstack/react-query";
import { meQuery } from "../api/session";

/**
 * An instant in the viewer's timezone, with Lagos time alongside when it reads differently
 * (TRD §5.1, C-27), e.g. "Mon 2 Nov 2026, 14:00 London (15:00 Lagos)".
 */
export function Time({ value, withDate = true }: { value: string | null; withDate?: boolean }) {
  const me = useQuery(meQuery);
  if (value === null) return <span>—</span>;
  const viewerZone = me.data?.user.timezone ?? me.data?.institution.timezone ?? "Africa/Lagos";
  const institutionZone = me.data?.institution.timezone ?? "Africa/Lagos";
  return (
    <time dateTime={value} title={value}>
      {formatDualTime(value, { viewerZone, institutionZone, withDate })}
    </time>
  );
}

/** The browser's own timezone, used to set a user's zone on first sign-in. */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * A calendar date (YYYY-MM-DD) such as a semester's start. Calendar dates belong to the
 * institution's calendar (§5.1), so they read the same in every timezone.
 */
export function CalendarDate({ value }: { value: string | null }) {
  if (value === null) return <span>—</span>;
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
  return <time dateTime={value}>{label}</time>;
}
