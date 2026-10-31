import { describe, expect, it } from "vitest";
import { awardEligibility, isProvisional } from "./awards";
import type { ResultLine } from "./grading";

const line = (
  courseId: string,
  creditsX10: number,
  passed: boolean,
  over: Partial<ResultLine> = {},
): ResultLine => ({
  courseId,
  attemptOrder: 1,
  creditsX10,
  pointsX100: passed ? 300 : 0,
  qualityPointsX1000: passed ? creditsX10 * 300 : 0,
  resultKind: "GRADED",
  countsInGpa: true,
  passed,
  ...over,
});

const curriculum = [
  { courseId: "A", creditsX10: 30 },
  { courseId: "B", creditsX10: 20 },
  { courseId: "C", creditsX10: 30 },
  { courseId: "D", creditsX10: 20 },
];

describe("awardEligibility (ADR-0005)", () => {
  it("needs half the curriculum's credits passed for the Certificate", () => {
    expect(awardEligibility(curriculum, [line("A", 30, true)], "BEST")).toEqual({
      totalCreditsX10: 100,
      passedCreditsX10: 30,
      certificate: false,
      diploma: false,
    });
    expect(
      awardEligibility(curriculum, [line("A", 30, true), line("B", 20, true)], "BEST"),
    ).toMatchObject({
      passedCreditsX10: 50,
      certificate: true,
      diploma: false,
    });
  });

  it("needs every curriculum course passed for the Diploma", () => {
    const all = curriculum.map((c) => line(c.courseId, c.creditsX10, true));
    expect(awardEligibility(curriculum, all, "BEST")).toMatchObject({
      certificate: true,
      diploma: true,
    });
    const oneFailed = [...all.slice(0, 3), line("D", 20, false)];
    expect(awardEligibility(curriculum, oneFailed, "BEST")).toMatchObject({
      passedCreditsX10: 80,
      diploma: false,
    });
  });

  it("counts a course passed on a retake once, and an exemption as passed", () => {
    const results = [
      line("A", 30, false),
      line("A", 30, true, { attemptOrder: 2 }),
      line("B", 20, false, { resultKind: "EXEMPT", passed: null, pointsX100: null }),
      line("C", 30, true),
      line("D", 20, true),
    ];
    expect(awardEligibility(curriculum, results, "BEST")).toEqual({
      totalCreditsX10: 100,
      passedCreditsX10: 100,
      certificate: true,
      diploma: true,
    });
  });

  it("ignores results for courses outside the curriculum", () => {
    expect(awardEligibility(curriculum, [line("X", 60, true)], "BEST")).toMatchObject({
      passedCreditsX10: 0,
      certificate: false,
    });
  });

  it("awards nothing for an empty curriculum", () => {
    expect(awardEligibility([], [], "BEST")).toEqual({
      totalCreditsX10: 0,
      passedCreditsX10: 0,
      certificate: false,
      diploma: false,
    });
  });
});

describe("isProvisional", () => {
  it("is provisional while any counted result isn't approved", () => {
    expect(isProvisional([{ status: "APPROVED", resultKind: "GRADED", countsInGpa: true }])).toBe(
      false,
    );
    expect(
      isProvisional([
        { status: "APPROVED", resultKind: "GRADED", countsInGpa: true },
        { status: "FINALIZED", resultKind: "GRADED", countsInGpa: true },
      ]),
    ).toBe(true);
  });

  it("ignores results that don't count, and is provisional with nothing yet", () => {
    expect(
      isProvisional([
        { status: "APPROVED", resultKind: "GRADED", countsInGpa: true },
        { status: "FINALIZED", resultKind: "AUDIT", countsInGpa: false },
      ]),
    ).toBe(false);
    expect(isProvisional([])).toBe(true);
  });
});
