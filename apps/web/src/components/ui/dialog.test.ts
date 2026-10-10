import { describe, expect, it } from "vitest";
import { reasonProblem } from "./dialog";

describe("reasonProblem", () => {
  it("asks for a reason that is long enough, ignoring surrounding spaces", () => {
    expect(reasonProblem("", 5)).toBe("Give a reason.");
    expect(reasonProblem("   ok   ", 5)).toBe("Write at least 5 characters.");
    expect(reasonProblem("Was in the room", 5)).toBeNull();
  });
});
