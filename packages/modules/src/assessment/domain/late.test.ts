import { describe, expect, it } from "vitest";
import {
  closesAt,
  daysLate,
  isLate,
  isOpen,
  suggestedPenaltyPercent,
  type LateRules,
} from "./late";

const due = new Date("2026-11-10T23:59:00Z");
const at = (iso: string) => new Date(iso);
const rules = (over: Partial<LateRules> = {}): LateRules => ({
  dueAt: due,
  cutoffAt: null,
  allowLate: false,
  ...over,
});

describe("closesAt / isOpen", () => {
  it.each([
    ["no late work: closes at the due date", rules(), due],
    ["late work, no cutoff: never closes", rules({ allowLate: true }), null],
    [
      "a cutoff wins either way",
      rules({ allowLate: true, cutoffAt: at("2026-11-13T23:59:00Z") }),
      at("2026-11-13T23:59:00Z"),
    ],
  ])("%s", (_why, r, expected) => {
    expect(closesAt(r)).toEqual(expected);
  });

  it("is open up to and including the closing instant", () => {
    expect(isOpen(rules(), due)).toBe(true);
    expect(isOpen(rules(), at("2026-11-10T23:59:00.001Z"))).toBe(false);
    expect(isOpen(rules({ allowLate: true }), at("2030-01-01T00:00:00Z"))).toBe(true);
  });
});

describe("lateness", () => {
  it.each([
    ["on time", "2026-11-10T23:59:00Z", false, 0, 0],
    ["one second late", "2026-11-10T23:59:01Z", true, 1, 10],
    ["exactly one day late", "2026-11-11T23:59:00Z", true, 1, 10],
    ["a day and a minute", "2026-11-12T00:00:00Z", true, 2, 20],
    ["very late, capped at 100 %", "2026-12-31T00:00:00Z", true, 51, 100],
  ])("%s", (_why, when, late, days, penalty) => {
    const r = rules({ allowLate: true, penaltyPercentPerDay: 10 });
    expect(isLate(r, at(when))).toBe(late);
    expect(daysLate(r, at(when))).toBe(days);
    expect(suggestedPenaltyPercent(r, at(when))).toBe(penalty);
  });

  it("suggests nothing without a penalty rate", () => {
    expect(suggestedPenaltyPercent(rules({ allowLate: true }), at("2026-11-12T00:00:00Z"))).toBe(0);
  });
});
