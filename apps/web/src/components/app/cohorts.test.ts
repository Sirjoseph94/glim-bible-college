import type { SemesterResultRow } from "@glim/contracts";
import { describe, expect, it } from "vitest";
import { cohortLabel, cohortState, summarize } from "./cohorts";

const row = (
  status: SemesterResultRow["status"],
  draftCourseCodes: string[] = [],
  levelNo: number | null = 1,
) =>
  ({
    status,
    draftCourseResults: draftCourseCodes.length,
    draftCourseCodes,
    levelNo,
  }) as SemesterResultRow;

describe("cohorts (handoff §11.10)", () => {
  it("counts each student once, by what approving would do to them", () => {
    expect(
      summarize([
        row("DRAFT"),
        row("DRAFT", ["GRK 301"]),
        row("APPROVED"),
        row("PUBLISHED"),
        row("DRAFT"),
      ]),
    ).toEqual({
      ready: 2,
      blocked: 1,
      approved: 1,
      published: 1,
      total: 5,
      waitingOn: ["GRK 301"],
      levels: [1],
    });
  });

  it("offers approval while anyone can be approved, naming the course the others wait on", () => {
    const state = cohortState(summarize([row("DRAFT"), row("DRAFT", ["GRK 301", "PAS 210"])]));
    expect(state).toMatchObject({ word: "Ready to approve", next: "approve" });
    expect(state.note).toBe("Waiting on GRK 301, PAS 210 · 1 student");
  });

  it("names at most three courses", () => {
    const state = cohortState(
      summarize([
        row("DRAFT", ["A 1", "B 2"]),
        row("DRAFT", ["C 3", "D 4", "B 2"]),
        row("DRAFT", ["E 5"]),
      ]),
    );
    expect(state.note).toBe("Waiting on A 1, B 2, C 3 +2 · 3 students");
  });

  it("offers publishing what is approved but not yet published", () => {
    expect(cohortState(summarize([row("APPROVED"), row("PUBLISHED")]))).toMatchObject({
      word: "Approved, not published",
      next: "publish",
      note: null,
    });
  });

  it("is provisional with nothing to do while every draft waits on a reopened result", () => {
    expect(cohortState(summarize([row("DRAFT", ["GRK 301"]), row("PUBLISHED")]))).toMatchObject({
      word: "Provisional",
      next: null,
      note: "Waiting on GRK 301 · 1 student",
    });
  });

  it("is published when every student is", () => {
    expect(cohortState(summarize([row("PUBLISHED")]))).toMatchObject({
      word: "Published",
      next: null,
    });
  });
});

describe("cohortLabel", () => {
  it("adds the level, or the range of levels", () => {
    expect(cohortLabel("BTH", [1])).toBe("BTH · Year 1");
    expect(cohortLabel("BTH", [1, 2])).toBe("BTH · Years 1–2");
    expect(cohortLabel("BTH", [1, 3])).toBe("BTH · Years 1, 3");
    expect(cohortLabel("BTH", [])).toBe("BTH");
  });
});
