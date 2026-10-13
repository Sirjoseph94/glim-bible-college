import { describe, expect, it } from "vitest";
import { programmeLength } from "./intake";

const programme = (awardType: "CERTIFICATE" | "DIPLOMA", levels: number) => ({
  id: "00000000-0000-4000-8000-000000000000",
  code: "X",
  name: "X",
  awardType,
  levels,
  durationSemesters: levels * 2,
});

describe("programmeLength", () => {
  it("names the years of the Certificate and the Diploma", () => {
    expect(programmeLength(programme("CERTIFICATE", 1))).toBe("1 year · Year 1");
    expect(programmeLength(programme("DIPLOMA", 2))).toBe("2 years · Years 1 and 2");
  });
});
