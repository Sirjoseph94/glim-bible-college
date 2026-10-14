import { describe, expect, it } from "vitest";
import { attendanceExplanation, percent, ranFor } from "./attendance-explanation";

const rule = {
  basis: "ACTUAL_CAPPED" as const,
  presentThresholdBp: 7500,
  partialThresholdBp: 2500,
};

describe("percent", () => {
  it("shows basis points as a percentage, without needless decimals", () => {
    expect(percent(7500)).toBe("75%");
    expect(percent(6667)).toBe("66.67%");
    expect(percent(2550)).toBe("25.5%");
  });
});

describe("attendanceExplanation (handoff §11.8)", () => {
  it("explains the thresholds against the time the class ran", () => {
    expect(attendanceExplanation(rule)).toBe(
      "Present means in class for at least 75% of the time it ran; Partial, at least 25%. Tap a student to change their status; a reason is required.",
    );
  });

  it("says scheduled time when the policy counts the scheduled length", () => {
    expect(
      attendanceExplanation({ ...rule, basis: "SCHEDULED", presentThresholdBp: 8000 }),
    ).toContain("at least 80% of the scheduled time");
  });
});

describe("ranFor", () => {
  it("says how long the class ran, when known", () => {
    expect(ranFor(3480)).toBe("class ran 58 min");
    expect(ranFor(5400)).toBe("class ran 1 h 30 min");
    expect(ranFor(null)).toBeNull();
  });
});
