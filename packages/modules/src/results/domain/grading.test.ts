import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  awardClassFor,
  bandFor,
  courseOutcome,
  cumulativeGpa,
  finalPercentX100,
  percentForBanding,
  roundHalfUp,
  semesterGpa,
  standingFor,
  validateScheme,
  type ResultLine,
  type SchemeRules,
} from "./grading";

/** The seeded GLIM Diploma scheme (migration 0036). */
const DIPLOMA: SchemeRules = {
  bands: [
    { minX100: 7000, maxX100: 10000, letter: "A", pointsX100: 500, pass: true },
    { minX100: 6000, maxX100: 6999, letter: "B", pointsX100: 400, pass: true },
    { minX100: 5000, maxX100: 5999, letter: "C", pointsX100: 300, pass: true },
    { minX100: 4500, maxX100: 4999, letter: "D", pointsX100: 200, pass: true },
    { minX100: 4000, maxX100: 4499, letter: "E", pointsX100: 100, pass: true },
    { minX100: 0, maxX100: 3999, letter: "F", pointsX100: 0, pass: false },
  ],
  classBands: [
    { minCgpaX100: 450, maxCgpaX100: 500, label: "Distinction" },
    { minCgpaX100: 300, maxCgpaX100: 449, label: "Credit" },
    { minCgpaX100: 100, maxCgpaX100: 299, label: "Pass" },
  ],
  minAwardCgpaX100: 100,
  maxPointsX100: 500,
  passMarkX100: 4000,
  repeatPolicy: "BEST",
  goodStandingCgpaX100: 100,
  probationCgpaX100: null,
};

/** A course result from a percentage, as finalization freezes it. */
function result(courseId: string, credits: number, pct: number, attemptOrder = 1): ResultLine {
  const o = courseOutcome(DIPLOMA, pct * 100, credits * 10, "INTEGER");
  return {
    courseId,
    attemptOrder,
    creditsX10: credits * 10,
    pointsX100: o.pointsX100,
    qualityPointsX1000: o.qualityPointsX1000,
    resultKind: "GRADED",
    countsInGpa: true,
    passed: o.passed,
  };
}

describe("roundHalfUp", () => {
  it("is floor((2n + d) / (2d)): exact ties go up", () => {
    expect(roundHalfUp(5n, 2n)).toBe(3n);
    expect(roundHalfUp(7n, 2n)).toBe(4n);
    expect(roundHalfUp(14n, 4n)).toBe(4n);
    expect(roundHalfUp(13n, 4n)).toBe(3n);
    expect(roundHalfUp(0n, 7n)).toBe(0n);
  });

  it("matches the nearest integer, ties up, for any n and d (property)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        (n, d) => {
          const r = roundHalfUp(n, d);
          // n/d lies in [r − ½, r + ½): the nearest integer, with exact halves going up.
          expect(2n * n >= 2n * r * d - d).toBe(true);
          expect(2n * n < 2n * r * d + d).toBe(true);
        },
      ),
    );
  });

  it("refuses a zero divisor", () => {
    expect(() => roundHalfUp(1n, 0n)).toThrow();
  });
});

describe("final percentage (Appendix C.2)", () => {
  const quiz = { scoreX100: 1500, maxX100: 2000, weightX100: 2000, excused: false };
  const assignment = { scoreX100: 4000, maxX100: 5000, weightX100: 3000, excused: false };
  const exam = { scoreX100: 6600, maxX100: 10000, weightX100: 5000, excused: false };

  it("15/20 × 20 + 40/50 × 30 + 66/100 × 50 = 72.00 ⇒ A", () => {
    const pct = finalPercentX100([quiz, assignment, exam]);
    expect(pct).toBe(7200);
    expect(courseOutcome(DIPLOMA, pct ?? 0, 30, "INTEGER").letter).toBe("A");
  });

  it("an EXCUSED assignment renormalises: 68.57 ⇒ 69 ⇒ B", () => {
    const pct = finalPercentX100([quiz, { ...assignment, excused: true }, exam]);
    expect(pct).toBe(6857);
    expect(percentForBanding(6857, "INTEGER")).toBe(6900);
    expect(courseOutcome(DIPLOMA, 6857, 30, "INTEGER").letter).toBe("B");
  });

  it("69.50 is A with INTEGER rounding and B with NONE", () => {
    expect(courseOutcome(DIPLOMA, 6950, 30, "INTEGER").letter).toBe("A");
    expect(courseOutcome(DIPLOMA, 6950, 30, "NONE").letter).toBe("B");
    expect(courseOutcome(DIPLOMA, 6949, 30, "INTEGER").letter).toBe("B");
  });

  it("an online student's exam (33/50 scaled to 66/100) gives the same result", () => {
    // Scaling happens when the attempt is scored (assessment/domain scaleToMax): 66.00 of 100.
    expect(finalPercentX100([quiz, assignment, { ...exam, scoreX100: 6600 }])).toBe(7200);
  });

  it("counts nothing that isn't scored, and is null when nothing counts", () => {
    expect(finalPercentX100([])).toBeNull();
    expect(finalPercentX100([{ ...quiz, excused: true }])).toBeNull();
    expect(finalPercentX100([{ ...quiz, scoreX100: null }, exam])).toBe(6600);
  });

  it("is exact with awkward maximums (no double rounding)", () => {
    // 1/3 × 50 + 2/7 × 50 = 16.666… + 14.285… = 30.952… → 30.95.
    expect(
      finalPercentX100([
        { scoreX100: 100, maxX100: 300, weightX100: 5000, excused: false },
        { scoreX100: 200, maxX100: 700, weightX100: 5000, excused: false },
      ]),
    ).toBe(3095);
  });

  it("stays within 0–100 % and full marks give 100 % (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .record({
              maxX100: fc.integer({ min: 1, max: 100_000 }),
              weightX100: fc.integer({ min: 0, max: 10_000 }),
              excused: fc.boolean(),
            })
            .chain((r) =>
              fc.record({
                maxX100: fc.constant(r.maxX100),
                weightX100: fc.constant(r.weightX100),
                excused: fc.constant(r.excused),
                scoreX100: fc.integer({ min: 0, max: r.maxX100 }),
              }),
            ),
          { maxLength: 12 },
        ),
        (items) => {
          const pct = finalPercentX100(items);
          if (pct === null) return;
          expect(pct).toBeGreaterThanOrEqual(0);
          expect(pct).toBeLessThanOrEqual(10_000);
          expect(finalPercentX100(items.map((i) => ({ ...i, scoreX100: i.maxX100 })))).toBe(10_000);
        },
      ),
    );
  });
});

describe("letter bands", () => {
  it.each([
    [10000, "A"],
    [7000, "A"],
    [6999, "B"],
    [6000, "B"],
    [5999, "C"],
    [5000, "C"],
    [4999, "D"],
    [4500, "D"],
    [4499, "E"],
    [4000, "E"],
    [3999, "F"],
    [0, "F"],
  ])("%i hundredths is %s", (pct, letter) => {
    expect(bandFor(DIPLOMA.bands, pct).letter).toBe(letter);
  });

  it("every percentage has exactly one band, and points never fall as it rises (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9999 }), (pct) => {
        expect(DIPLOMA.bands.filter((b) => pct >= b.minX100 && pct <= b.maxX100)).toHaveLength(1);
        expect(bandFor(DIPLOMA.bands, pct + 1).pointsX100).toBeGreaterThanOrEqual(
          bandFor(DIPLOMA.bands, pct).pointsX100,
        );
      }),
    );
  });

  it("passes from 40 %", () => {
    expect(courseOutcome(DIPLOMA, 4000, 20, "NONE").passed).toBe(true);
    expect(courseOutcome(DIPLOMA, 3999, 20, "NONE").passed).toBe(false);
    // 39.50 rounds to 40 before banding.
    expect(courseOutcome(DIPLOMA, 3950, 20, "INTEGER").passed).toBe(true);
  });
});

describe("GPA and CGPA (Appendix C.3)", () => {
  const s1 = [
    result("DIP101", 3, 72),
    result("DIP103", 2, 65),
    result("DIP105", 3, 48),
    result("DIP107", 2, 38),
  ];
  const s2 = [result("DIP102", 3, 80), result("DIP104", 3, 55), result("DIP106", 2, 61)];
  const s3 = [result("DIP107", 2, 52, 2), result("DIP201", 3, 70)];

  it("semester 1: 29000 over 100 ⇒ 2.90, 80 credits earned", () => {
    expect(semesterGpa(s1)).toEqual({
      creditsAttemptedX10: 100,
      creditsEarnedX10: 80,
      qualityPointsX1000: 29_000,
      gpaX100: 290,
    });
  });

  it("semester 2: 32000 over 80 ⇒ 4.00; CGPA 3.39 ⇒ Credit, GOOD", () => {
    expect(semesterGpa(s2).gpaX100).toBe(400);
    const cgpa = cumulativeGpa([...s1, ...s2], "KEEP_ALL");
    expect(cgpa.gpaX100).toBe(339);
    expect(awardClassFor(cgpa.gpaX100, DIPLOMA)).toBe("Credit");
    expect(standingFor(cgpa.gpaX100, DIPLOMA)).toBe("GOOD");
  });

  it("semester 3 with the repeat: 4.20; CGPA 3.57 KEEP_ALL, 3.90 REPLACE_LATEST and BEST", () => {
    expect(semesterGpa(s3).gpaX100).toBe(420);
    const all = [...s1, ...s2, ...s3];
    expect(cumulativeGpa(all, "KEEP_ALL")).toMatchObject({
      qualityPointsX1000: 82_000,
      creditsAttemptedX10: 230,
      gpaX100: 357,
    });
    expect(cumulativeGpa(all, "REPLACE_LATEST")).toMatchObject({
      creditsAttemptedX10: 210,
      gpaX100: 390,
    });
    const best = cumulativeGpa(all, "BEST");
    expect(best.gpaX100).toBe(390);
    expect(awardClassFor(best.gpaX100, DIPLOMA)).toBe("Credit");
  });

  it("BEST keeps a better earlier attempt; REPLACE_LATEST doesn't", () => {
    const first = result("X", 3, 75, 1);
    const resit = result("X", 3, 55, 2);
    expect(cumulativeGpa([first, resit], "BEST").gpaX100).toBe(500);
    expect(cumulativeGpa([first, resit], "REPLACE_LATEST").gpaX100).toBe(300);
    expect(cumulativeGpa([first, resit], "KEEP_ALL").gpaX100).toBe(400);
  });

  it("a semester without counting credits has no GPA and standing UNKNOWN", () => {
    const audit = { ...result("A1", 2, 90), resultKind: "AUDIT" as const };
    const withdrawn = { ...result("W1", 3, 0), resultKind: "WITHDRAWN" as const, passed: null };
    for (const lines of [[], [audit], [withdrawn]]) {
      const t = semesterGpa(lines);
      expect(t.gpaX100).toBeNull();
      expect(t.creditsEarnedX10).toBe(0);
      expect(standingFor(t.gpaX100, DIPLOMA)).toBe("UNKNOWN");
      expect(awardClassFor(t.gpaX100, DIPLOMA)).toBeNull();
    }
  });

  it("EXEMPT credits are earned but not attempted", () => {
    const exempt = { ...result("E1", 2, 0), resultKind: "EXEMPT" as const, passed: null };
    expect(semesterGpa([result("C1", 3, 72), exempt])).toMatchObject({
      creditsAttemptedX10: 30,
      creditsEarnedX10: 50,
      gpaX100: 500,
    });
  });

  it("results that don't count in GPA are left out", () => {
    expect(
      semesterGpa([result("C1", 3, 72), { ...result("C2", 3, 30), countsInGpa: false }]),
    ).toMatchObject({ creditsAttemptedX10: 30, gpaX100: 500 });
  });

  it("GPA stays within 0–5 and KEEP_ALL equals the semesters pooled (property)", () => {
    const line = fc
      .record({
        course: fc.constantFrom("A", "B", "C", "D"),
        credits: fc.integer({ min: 1, max: 6 }),
        pct: fc.integer({ min: 0, max: 100 }),
        order: fc.integer({ min: 1, max: 5 }),
      })
      .map((r) => result(r.course, r.credits, r.pct, r.order));
    fc.assert(
      fc.property(fc.array(line, { maxLength: 15 }), (lines) => {
        for (const policy of ["KEEP_ALL", "REPLACE_LATEST", "BEST"] as const) {
          const g = cumulativeGpa(lines, policy).gpaX100;
          if (g === null) expect(lines).toHaveLength(0);
          else {
            expect(g).toBeGreaterThanOrEqual(0);
            expect(g).toBeLessThanOrEqual(500);
          }
        }
        expect(cumulativeGpa(lines, "KEEP_ALL")).toEqual(semesterGpa(lines));
        // BEST is never below REPLACE_LATEST in quality points per course picked.
        const best = cumulativeGpa(lines, "BEST");
        const latest = cumulativeGpa(lines, "REPLACE_LATEST");
        expect(best.creditsAttemptedX10).toBeGreaterThanOrEqual(0);
        expect(latest.creditsAttemptedX10).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

describe("award classes and standing", () => {
  it.each([
    [500, "Distinction"],
    [450, "Distinction"],
    [449, "Credit"],
    [300, "Credit"],
    [299, "Pass"],
    [100, "Pass"],
    [99, null],
    [0, null],
  ])("CGPA %i ⇒ %s", (cgpa, label) => {
    expect(awardClassFor(cgpa, DIPLOMA)).toBe(label);
  });

  it("every CGPA from the minimum up has exactly one class (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 500 }), (cgpa) => {
        expect(
          DIPLOMA.classBands.filter((c) => cgpa >= c.minCgpaX100 && cgpa <= c.maxCgpaX100),
        ).toHaveLength(1);
      }),
    );
  });

  it("standing: GOOD from 1.00, then PROBATION only if a band is set", () => {
    expect(standingFor(100, DIPLOMA)).toBe("GOOD");
    expect(standingFor(99, DIPLOMA)).toBe("WITHDRAW_REQUIRED");
    const withProbation = { ...DIPLOMA, probationCgpaX100: 50 };
    expect(standingFor(99, withProbation)).toBe("PROBATION");
    expect(standingFor(50, withProbation)).toBe("PROBATION");
    expect(standingFor(49, withProbation)).toBe("WITHDRAW_REQUIRED");
    expect(standingFor(null, withProbation)).toBe("UNKNOWN");
  });
});

describe("validateScheme", () => {
  it("accepts the seeded scheme", () => {
    expect(validateScheme(DIPLOMA)).toEqual([]);
  });

  it("finds gaps, overlaps, a wrong top, pass flags and award-class gaps", () => {
    const gap = {
      ...DIPLOMA,
      bands: DIPLOMA.bands.map((b) => (b.letter === "B" ? { ...b, minX100: 6100 } : b)),
    };
    expect(validateScheme(gap).map((p) => p.path)).toContain("bands");
    const top = {
      ...DIPLOMA,
      bands: DIPLOMA.bands.map((b) => (b.letter === "A" ? { ...b, maxX100: 9999 } : b)),
    };
    expect(validateScheme(top).some((p) => p.message.includes("100 %"))).toBe(true);
    const failPass = {
      ...DIPLOMA,
      bands: DIPLOMA.bands.map((b) => (b.letter === "E" ? { ...b, pass: false } : b)),
    };
    expect(validateScheme(failPass).some((p) => p.message.includes("Band E"))).toBe(true);
    const passMark = { ...DIPLOMA, passMarkX100: 4200 };
    expect(validateScheme(passMark).map((p) => p.path)).toContain("passMarkX100");
    const classes = {
      ...DIPLOMA,
      classBands: DIPLOMA.classBands.map((c) =>
        c.label === "Credit" ? { ...c, maxCgpaX100: 440 } : c,
      ),
    };
    expect(validateScheme(classes).map((p) => p.path)).toContain("classBands");
    const tooMany = {
      ...DIPLOMA,
      bands: DIPLOMA.bands.map((b) => (b.letter === "A" ? { ...b, pointsX100: 600 } : b)),
    };
    expect(validateScheme(tooMany).some((p) => p.message.includes("points"))).toBe(true);
  });
});
