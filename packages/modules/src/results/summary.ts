import type { ResultSummary } from "@glim/contracts";
import type { schema } from "@glim/db";
import { isProvisional } from "./domain/awards";
import {
  cumulativeGpa,
  standingFor,
  type ResultKind,
  type ResultLine,
  type SchemeRules,
} from "./domain/grading";

type ResultRow = typeof schema.courseResults.$inferSelect;

/** A course result as GPA arithmetic sees it. */
export function lineOf(row: ResultRow): ResultLine {
  return {
    courseId: row.courseId,
    attemptOrder: row.attemptNo,
    creditsX10: row.creditsX10,
    pointsX100: row.pointsX100,
    qualityPointsX1000: row.qualityPointsX1000 ?? 0,
    resultKind: row.resultKind as ResultKind,
    countsInGpa: row.countsInGpa,
    passed: row.passed,
  };
}

/**
 * Credits, CGPA and standing over a programme enrollment's finalized results so far (§14.4),
 * worked out on the fly with the programme's scheme, and Provisional until the Registrar has
 * approved every result counted (ADR-0005). Pass only finalized or approved rows.
 */
export function summarize(rows: ResultRow[], rules: SchemeRules | null): ResultSummary {
  const cgpa = cumulativeGpa(rows.map(lineOf), rules?.repeatPolicy ?? "BEST");
  return {
    creditsAttemptedX10: cgpa.creditsAttemptedX10,
    creditsEarnedX10: cgpa.creditsEarnedX10,
    cgpaX100: cgpa.gpaX100,
    standing: rules === null ? "UNKNOWN" : standingFor(cgpa.gpaX100, rules),
    provisional: isProvisional(rows),
  };
}
