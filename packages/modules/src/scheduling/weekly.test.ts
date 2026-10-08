import { describe, expect, it } from "vitest";
import { addDays, fromRrule, toRrule, weeklyOccurrences, type WeeklyRule } from "./weekly";

const rule = (r: Partial<WeeklyRule>): WeeklyRule => ({
  startsOn: "2080-09-04", // a Wednesday
  untilOn: null,
  weekdays: ["MO", "WE"],
  interval: 1,
  ...r,
});

describe("weeklyOccurrences", () => {
  it("lists the chosen weekdays from the start date, numbered from 1", () => {
    expect(weeklyOccurrences(rule({}), "2080-09-16")).toEqual([
      { date: "2080-09-04", n: 1 },
      { date: "2080-09-09", n: 2 },
      { date: "2080-09-11", n: 3 },
      { date: "2080-09-16", n: 4 },
    ]);
  });

  it("skips weeks for an interval, counting from the start date's week (Tuesday 3rd is before the start)", () => {
    expect(
      weeklyOccurrences(rule({ weekdays: ["TU"], interval: 2 }), "2080-10-01").map((o) => o.date),
    ).toEqual(["2080-09-17", "2080-10-01"]);
  });

  it("stops at the until date and keeps numbering stable as the horizon grows", () => {
    const r = rule({ weekdays: ["WE"], untilOn: "2080-09-25" });
    expect(weeklyOccurrences(r, "2080-09-11")).toEqual([
      { date: "2080-09-04", n: 1 },
      { date: "2080-09-11", n: 2 },
    ]);
    expect(weeklyOccurrences(r, "2080-12-31").map((o) => o.n)).toEqual([1, 2, 3, 4]);
  });

  it("crosses month and year ends", () => {
    expect(
      weeklyOccurrences(rule({ startsOn: "2080-12-30", weekdays: ["MO"] }), "2081-01-14").map(
        (o) => o.date,
      ),
    ).toEqual(["2080-12-30", "2081-01-06", "2081-01-13"]);
  });
});

describe("rrule text", () => {
  it("round-trips", () => {
    const r = rule({ weekdays: ["WE", "MO"], interval: 2, untilOn: "2081-01-29" });
    expect(toRrule(r)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20810129");
    expect(fromRrule(toRrule(r), r.startsOn)).toEqual({ ...r, weekdays: ["MO", "WE"] });
    expect(fromRrule("FREQ=DAILY", "2080-01-01")).toBeNull();
  });
});

it("adds days across months", () => {
  expect(addDays("2080-02-28", 2)).toBe("2080-03-01");
});
