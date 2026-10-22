import type { MeetingAttendance } from "@glim/contracts";

/** Basis points as a percentage: 7500 → "75%", 6667 → "66.67%". */
export function percent(bp: number): string {
  return `${String(Number((bp / 100).toFixed(2)))}%`;
}

/**
 * What Present and Partial mean for this class (handoff §11.8), from the policy the records were
 * computed under, so the words always match the rule.
 */
export function attendanceExplanation(rule: MeetingAttendance["rule"]): string {
  const of = rule.basis === "SCHEDULED" ? "of the scheduled time" : "of the time it ran";
  return `Present means in class for at least ${percent(rule.presentThresholdBp)} ${of}; Partial, at least ${percent(rule.partialThresholdBp)}. Tap a student to change their status; a reason is required.`;
}

/** "class ran 58 min", or null when the length isn't known. */
export function ranFor(seconds: number | null): string | null {
  if (seconds === null) return null;
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `class ran ${h === 0 ? `${String(m)} min` : `${String(h)} h ${String(m)} min`}`;
}
