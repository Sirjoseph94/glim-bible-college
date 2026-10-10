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
