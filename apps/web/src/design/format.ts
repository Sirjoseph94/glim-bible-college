/** "310 KB", "1.2 MB" (handoff §10.6). */
export function fileSize(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1024) return `${String(Math.max(1, Math.round(kb)))} KB`;
  const mb = kb / 1024;
  return `${mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1).replace(/\.0$/, "")} MB`;
}

/** Words in a piece of writing, for the word-count hint (§9.5). */
export function wordCount(text: string): number {
  const words = text.trim().split(/\s+/u);
  return words[0] === "" ? 0 : words.length;
}

export type DueState = "open" | "soon" | "late" | "closed";

const SOON_MS = 72 * 60 * 60 * 1000;

/**
 * Where a piece of work stands against its dates (§11.5): due soon within 72 hours; after the
 * due date, late work is accepted until it closes (when it has a later close date).
 */
export function dueState(dueAt: string, closesAt: string | null, now: Date): DueState {
  const due = new Date(dueAt).getTime();
  const t = now.getTime();
  if (t <= due) return due - t <= SOON_MS ? "soon" : "open";
  if (closesAt !== null && t <= new Date(closesAt).getTime()) return "late";
  return "closed";
}

/** Hundredths as two decimals, e.g. 420 → "4.20" (GPA, CGPA, percentages; §10.6, §16.1). */
export function hundredths(value: number | null): string {
  if (value === null) return "—";
  return `${String(Math.trunc(value / 100))}.${String(value % 100).padStart(2, "0")}`;
}

/** A percentage from hundredths (§10.6): whole numbers, two decimals only under 1%. */
export function percent(valueX100: number): string {
  return valueX100 < 100
    ? `${hundredths(valueX100)}%`
    : `${String(Math.floor((valueX100 + 50) / 100))}%`;
}

/** Tenths of a credit, e.g. 30 → "3", 25 → "2.5". */
export function credits(tenths: number): string {
  return tenths % 10 === 0
    ? String(tenths / 10)
    : `${String(Math.trunc(tenths / 10))}.${String(tenths % 10)}`;
}
