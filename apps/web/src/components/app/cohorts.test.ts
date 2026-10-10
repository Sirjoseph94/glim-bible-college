import type { SemesterResultRow } from "@glim/contracts";
import { describe, expect, it } from "vitest";
import { cohortState, summarize } from "./cohorts";

const row = (status: SemesterResultRow["status"], draftCourseResults = 0) =>
  ({ status, draftCourseResults }) as SemesterResultRow;

describe("cohorts (handoff §11.10)", () => {
  it("counts each student once, by what approving would do to them", () => {
    expect(
      summarize([row("DRAFT"), row("DRAFT", 1), row("APPROVED"), row("PUBLISHED"), row("DRAFT")]),
    ).toEqual({ ready: 2, blocked: 1, approved: 1, published: 1, total: 5 });
  });

  it("offers approval while anyone can be approved, saying who must wait", () => {
    const state = cohortState(summarize([row("DRAFT"), row("DRAFT", 2)]));
    expect(state).toMatchObject({ word: "Ready to approve", next: "approve" });
    expect(state.note).toBe("1 waits on a reopened course result");
  });

  it("offers publishing what is approved but not yet published", () => {
    expect(cohortState(summarize([row("APPROVED"), row("PUBLISHED")]))).toMatchObject({
      word: "Approved, not published",
      next: "publish",
      note: null,
    });
  });

  it("is provisional with nothing to do while every draft waits on a reopened result", () => {
    expect(cohortState(summarize([row("DRAFT", 1), row("PUBLISHED")]))).toMatchObject({
      word: "Provisional",
      next: null,
      note: "1 waits on a reopened course result",
    });
  });

  it("is published when every student is", () => {
    expect(cohortState(summarize([row("PUBLISHED")]))).toMatchObject({
      word: "Published",
      next: null,
    });
  });
});
