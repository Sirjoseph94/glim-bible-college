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
  };
}

const waits = (n: number) =>
  n === 0 ? null : `${String(n)} ${n === 1 ? "waits" : "wait"} on a reopened course result`;

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
    return { tone: "brand", word: "Ready to approve", next: "approve", note: waits(s.blocked) };
  if (s.approved > 0)
    return {
      tone: "info",
      word: "Approved, not published",
      next: "publish",
      note: waits(s.blocked),
    };
  if (s.blocked > 0)
    return { tone: "warning", word: "Provisional", next: null, note: waits(s.blocked) };
  return { tone: "success", word: "Published", next: null, note: null };
}
