/** A timestamp in the viewer's own timezone (the Lagos-alongside display arrives with ticket 06). */
export function formatTimestamp(iso: string | null, timeZone: string): string {
  if (iso === null) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
