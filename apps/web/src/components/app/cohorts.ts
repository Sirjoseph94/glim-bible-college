import type { SemesterResultRow } from "@glim/contracts";
import type { Tone } from "../ui/badge";

/** A cohort's students by what approving and publishing would do to them. */
export interface CohortSummary {
  /** Draft and approvable now. */
  ready: number;
  /** Draft, but a course result is reopened: the API skips them when approving. */
  blocked: number;
  /** Approved, not yet published. */
  approved: number;
  published: number;
  total: number;
  /** The reopened courses the blocked students wait on, sorted. */
  waitingOn: string[];
  /** The students' levels this semester, sorted (imported past results have none). */
  levels: number[];
}

export function summarize(rows: SemesterResultRow[]): CohortSummary {
  const drafts = rows.filter((r) => r.status === "DRAFT");
  const blocked = drafts.filter((r) => r.draftCourseResults > 0).length;
  return {
    ready: drafts.length - blocked,
    blocked,
    approved: rows.filter((r) => r.status === "APPROVED").length,
    published: rows.filter((r) => r.status === "PUBLISHED").length,
    total: rows.length,
    waitingOn: [...new Set(drafts.flatMap((r) => r.draftCourseCodes))].sort(),
    levels: [...new Set(rows.flatMap((r) => (r.levelNo === null ? [] : [r.levelNo])))].sort(
      (a, b) => a - b,
    ),
  };
}

/** "BTH · Year 1", "BTH · Years 1–2" or "BTH · Years 1, 3". */
export function cohortLabel(code: string, levels: number[]): string {
  const [first] = levels;
  const last = levels.at(-1);
  if (first === undefined || last === undefined) return code;
  if (levels.length === 1) return `${code} · Year ${String(first)}`;
  const contiguous = last - first === levels.length - 1;
  return `${code} · Years ${contiguous ? `${String(first)}–${String(last)}` : levels.join(", ")}`;
}

/** "Waiting on GRK 301, PAS 210 · 2 students" (three courses at most, then "+N"). */
function waits(s: CohortSummary): string | null {
  if (s.blocked === 0) return null;
  const shown = s.waitingOn.slice(0, 3).join(", ");
  const more = s.waitingOn.length > 3 ? ` +${String(s.waitingOn.length - 3)}` : "";
  return `Waiting on ${shown}${more} · ${String(s.blocked)} ${s.blocked === 1 ? "student" : "students"}`;
}

/**
 * Where a cohort is in compute → approve → publish (§11.10), as a word, the next step and a note.
 * Approval is offered while anyone can be approved: the API approves them and skips the rest.
 */
export function cohortState(s: CohortSummary): {
  tone: Tone;
  word: string;
  next: "approve" | "publish" | null;
  note: string | null;
} {
  if (s.ready > 0)
    return { tone: "brand", word: "Ready to approve", next: "approve", note: waits(s) };
  if (s.approved > 0)
    return {
      tone: "info",
      word: "Approved, not published",
      next: "publish",
      note: waits(s),
    };
  if (s.blocked > 0) return { tone: "warning", word: "Provisional", next: null, note: waits(s) };
  return { tone: "success", word: "Published", next: null, note: null };
}
