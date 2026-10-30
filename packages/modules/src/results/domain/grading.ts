/**
 * Results arithmetic (TRD §14.3, §14.4, INV-14): pure functions over integers only. Percentages
 * and GPAs are in hundredths (`_x100`), credits in tenths (`_x10`) and quality points in
 * thousandths (`_x1000` = credits_x10 × points_x100). Nothing here touches a float.
 */

export interface GradeBand {
  minX100: number;
  maxX100: number;
  letter: string;
  pointsX100: number;
  pass: boolean;
}

export interface ClassBand {
  minCgpaX100: number;
  maxCgpaX100: number;
  label: string;
}

export type RepeatPolicy = "KEEP_ALL" | "REPLACE_LATEST" | "BEST";
export type Standing = "GOOD" | "PROBATION" | "WITHDRAW_REQUIRED" | "UNKNOWN";
export type ResultKind = "GRADED" | "INCOMPLETE" | "WITHDRAWN" | "EXEMPT" | "AUDIT";
export type RoundBeforeBanding = "NONE" | "INTEGER";

export interface SchemeRules {
  bands: GradeBand[];
  classBands: ClassBand[];
  minAwardCgpaX100: number;
  maxPointsX100: number;
  passMarkX100: number;
  repeatPolicy: RepeatPolicy;
  goodStandingCgpaX100: number;
  probationCgpaX100: number | null;
}

/** `roundHalfUp(n, d) = floor((2n + d) / (2d))` for n ≥ 0, d > 0, exactly (TRD Appendix C). */
export function roundHalfUp(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError("roundHalfUp needs a positive divisor");
  if (n < 0n) throw new RangeError("roundHalfUp is for non-negative amounts");
  return (2n * n + d) / (2n * d);
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
const toNumber = (v: bigint): number => {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("result out of range");
  return Number(v);
};

/** One gradebook column in a final percentage; `scoreX100` null means it doesn't count. */
export interface WeightedScore {
  scoreX100: number | null;
  maxX100: number;
  weightX100: number;
  excused: boolean;
}

/**
 * `final_pct_x100 = roundHalfUp( Σ score × weight / max × 10000 / Σ weight )` over the columns
 * that count (§14.3). Excused columns drop out and the remaining weights renormalise. Computed as
 * one exact fraction, so mixed maximums never round twice. Null when nothing counts.
 */
export function finalPercentX100(items: WeightedScore[]): number | null {
  const counted = items.filter((i) => !i.excused && i.scoreX100 !== null && i.weightX100 > 0);
  const weights = counted.reduce((sum, i) => sum + BigInt(i.weightX100), 0n);
  if (weights === 0n) return null;
  // Σ s·w·10000/m as n/d with d the least common multiple of the maximums.
  const lcm = counted.reduce((l, i) => {
    const m = BigInt(i.maxX100);
    return (l / gcd(l, m)) * m;
  }, 1n);
  const numerator = counted.reduce((sum, i) => {
    if (i.maxX100 <= 0) throw new RangeError("a column's maximum must be positive");
    const score = BigInt(i.scoreX100 ?? 0);
    return sum + (score * BigInt(i.weightX100) * 10_000n * lcm) / BigInt(i.maxX100);
  }, 0n);
  return toNumber(roundHalfUp(numerator, lcm * weights));
}

/** `roundBeforeBanding` (§14.3): INTEGER rounds to a whole percent first (69.50 → 70). */
export function percentForBanding(pctX100: number, mode: RoundBeforeBanding): number {
  return mode === "INTEGER" ? toNumber(roundHalfUp(BigInt(pctX100), 100n)) * 100 : pctX100;
}

/** The band a percentage falls in; a valid scheme covers 0–100 % with no gaps. */
export function bandFor(bands: GradeBand[], pctX100: number): GradeBand {
  const band = bands.find((b) => pctX100 >= b.minX100 && pctX100 <= b.maxX100);
  if (band === undefined) throw new RangeError(`no band covers ${String(pctX100)}`);
  return band;
}

export interface CourseOutcome {
  finalPctX100: number;
  letter: string;
  pointsX100: number;
  qualityPointsX1000: number;
  passed: boolean;
}

/** A course's letter, points and quality points from its final percentage (frozen at finalize). */
export function courseOutcome(
  scheme: Pick<SchemeRules, "bands">,
  finalPctX100: number,
  creditsX10: number,
  mode: RoundBeforeBanding,
): CourseOutcome {
  const band = bandFor(scheme.bands, percentForBanding(finalPctX100, mode));
  return {
    finalPctX100,
    letter: band.letter,
    pointsX100: band.pointsX100,
    qualityPointsX1000: creditsX10 * band.pointsX100,
    passed: band.pass,
  };
}

/** A course result as GPA arithmetic sees it. */
export interface ResultLine {
  courseId: string;
  /** Orders attempts: a later attempt has a larger value (its attempt number). */
  attemptOrder: number;
  creditsX10: number;
  pointsX100: number | null;
  qualityPointsX1000: number;
  resultKind: ResultKind;
  countsInGpa: boolean;
  passed: boolean | null;
}

export interface GpaTotals {
  creditsAttemptedX10: number;
  creditsEarnedX10: number;
  qualityPointsX1000: number;
  /** Null when no counting credits (standing UNKNOWN). */
  gpaX100: number | null;
}

const counts = (r: ResultLine) => r.resultKind === "GRADED" && r.countsInGpa;

function totals(counting: ResultLine[], exempt: ResultLine[]): GpaTotals {
  const attempted = counting.reduce((sum, r) => sum + r.creditsX10, 0);
  const qp = counting.reduce((sum, r) => sum + r.qualityPointsX1000, 0);
  const earned =
    counting.filter((r) => r.passed === true).reduce((sum, r) => sum + r.creditsX10, 0) +
    exempt.reduce((sum, r) => sum + r.creditsX10, 0);
  return {
    creditsAttemptedX10: attempted,
    creditsEarnedX10: earned,
    qualityPointsX1000: qp,
    gpaX100: attempted === 0 ? null : toNumber(roundHalfUp(BigInt(qp), BigInt(attempted))),
  };
}

/**
 * CGPA over a programme enrollment's results so far, with the repeat policy:
 * KEEP_ALL counts every attempt; REPLACE_LATEST only the latest per course; BEST only the one
 * with the most points per course (the later one on a tie). Earlier attempts stay on transcripts.
 */
export function cumulativeGpa(results: ResultLine[], policy: RepeatPolicy): GpaTotals {
  const counting = results.filter(counts);
  let chosen = counting;
  if (policy !== "KEEP_ALL") {
    const byCourse = new Map<string, ResultLine>();
    for (const r of counting) {
      const held = byCourse.get(r.courseId);
      if (held === undefined) {
        byCourse.set(r.courseId, r);
        continue;
      }
      const later = r.attemptOrder > held.attemptOrder;
      const better =
        policy === "REPLACE_LATEST"
          ? later
          : (r.pointsX100 ?? 0) > (held.pointsX100 ?? 0) ||
            ((r.pointsX100 ?? 0) === (held.pointsX100 ?? 0) && later);
      if (better) byCourse.set(r.courseId, r);
    }
    chosen = [...byCourse.values()];
  }
  const exempt = new Map<string, ResultLine>();
  for (const r of results) if (r.resultKind === "EXEMPT") exempt.set(r.courseId, r);
  // A course passed and also exempted earns its credits once.
  const chosenPassed = new Set(chosen.filter((r) => r.passed === true).map((r) => r.courseId));
  return totals(
    chosen,
    [...exempt.values()].filter((r) => !chosenPassed.has(r.courseId)),
  );
}

/** Standing (§14.4, advisory): GOOD, else PROBATION if configured and met, else WITHDRAW_REQUIRED. */
export function standingFor(
  cgpaX100: number | null,
  scheme: Pick<SchemeRules, "goodStandingCgpaX100" | "probationCgpaX100">,
): Standing {
  if (cgpaX100 === null) return "UNKNOWN";
  if (cgpaX100 >= scheme.goodStandingCgpaX100) return "GOOD";
  if (scheme.probationCgpaX100 !== null && cgpaX100 >= scheme.probationCgpaX100) return "PROBATION";
  return "WITHDRAW_REQUIRED";
}

/** The award class for a final CGPA, or null for no award (below the minimum, or undefined). */
export function awardClassFor(
  cgpaX100: number | null,
  scheme: Pick<SchemeRules, "classBands" | "minAwardCgpaX100">,
): string | null {
  if (cgpaX100 === null || cgpaX100 < scheme.minAwardCgpaX100) return null;
  return (
    scheme.classBands.find((c) => cgpaX100 >= c.minCgpaX100 && cgpaX100 <= c.maxCgpaX100)?.label ??
    null
  );
}

/** A problem with a scheme, for the Registrar's form. */
export interface SchemeProblem {
  path: string;
  message: string;
}

/**
 * Checks a scheme before it's saved: letter bands cover 0–100 % in whole hundredths with no gaps
 * or overlaps, points stay within the maximum and only bands from the pass mark up pass; award
 * classes run without gaps from the minimum for an award up to the maximum points.
 */
export function validateScheme(s: SchemeRules): SchemeProblem[] {
  const problems: SchemeProblem[] = [];
  const bands = [...s.bands].sort((a, b) => a.minX100 - b.minX100);
  if (bands.length === 0) problems.push({ path: "bands", message: "Add at least one band." });
  let next = 0;
  for (const b of bands) {
    if (b.minX100 !== next)
      problems.push({
        path: "bands",
        message: `The bands must run from 0 to 100 % without gaps or overlaps (check ${b.letter}).`,
      });
    if (b.maxX100 < b.minX100)
      problems.push({ path: "bands", message: `Band ${b.letter} ends before it starts.` });
    if (b.pointsX100 < 0 || b.pointsX100 > s.maxPointsX100)
      problems.push({
        path: "bands",
        message: `Band ${b.letter}'s points must be between 0 and the maximum.`,
      });
    if (b.pass !== b.minX100 >= s.passMarkX100)
      problems.push({
        path: "bands",
        message: `Band ${b.letter} must ${b.minX100 >= s.passMarkX100 ? "" : "not "}pass with a pass mark of ${String(s.passMarkX100 / 100)} %.`,
      });
    next = b.maxX100 + 1;
  }
  if (bands.length > 0 && next !== 10_001)
    problems.push({ path: "bands", message: "The top band must end at 100 %." });
  if (new Set(bands.map((b) => b.letter)).size !== bands.length)
    problems.push({ path: "bands", message: "Each band needs its own letter." });
  if (!bands.some((b) => b.minX100 === s.passMarkX100))
    problems.push({ path: "passMarkX100", message: "The pass mark must be where a band starts." });

  const classes = [...s.classBands].sort((a, b) => a.minCgpaX100 - b.minCgpaX100);
  let from = s.minAwardCgpaX100;
  for (const c of classes) {
    if (c.minCgpaX100 !== from)
      problems.push({
        path: "classBands",
        message: `Award classes must run from the minimum for an award without gaps (check ${c.label}).`,
      });
    if (c.maxCgpaX100 < c.minCgpaX100)
      problems.push({ path: "classBands", message: `${c.label} ends before it starts.` });
    from = c.maxCgpaX100 + 1;
  }
  if (classes.length > 0 && from !== s.maxPointsX100 + 1)
    problems.push({
      path: "classBands",
      message: "The top award class must end at the maximum points.",
    });
  if (new Set(classes.map((c) => c.label)).size !== classes.length)
    problems.push({ path: "classBands", message: "Each award class needs its own name." });
  if (s.goodStandingCgpaX100 > s.maxPointsX100)
    problems.push({
      path: "goodStandingCgpaX100",
      message: "Good standing can't be above the maximum points.",
    });
  return problems;
}
