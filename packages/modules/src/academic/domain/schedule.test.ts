import { describe, expect, it } from "vitest";
import { layOutSchedule } from "./schedule";

describe("layOutSchedule", () => {
  it("lays courses end to end, each ending with its exam", () => {
    expect(layOutSchedule("2027-09-06", 4, 3)).toEqual([
      { startsOn: "2027-09-06", endsOn: "2027-10-03", examOn: "2027-10-03" },
      { startsOn: "2027-10-04", endsOn: "2027-10-31", examOn: "2027-10-31" },
      { startsOn: "2027-11-01", endsOn: "2027-11-28", examOn: "2027-11-28" },
    ]);
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(layOutSchedule("2027-12-20", 1, 2)).toEqual([
      { startsOn: "2027-12-20", endsOn: "2027-12-26", examOn: "2027-12-26" },
      { startsOn: "2027-12-27", endsOn: "2028-01-02", examOn: "2028-01-02" },
    ]);
    expect(layOutSchedule("2028-02-26", 1, 1)).toEqual([
      { startsOn: "2028-02-26", endsOn: "2028-03-03", examOn: "2028-03-03" },
    ]);
  });

  it("lays out nothing for no courses", () => {
    expect(layOutSchedule("2027-09-06", 4, 0)).toEqual([]);
  });
});
