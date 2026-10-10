import type { ClassMeeting } from "@glim/contracts";
import { describe, expect, it } from "vitest";
import { byDay, planToday, type ScheduledMeeting } from "./today";

let n = 0;
function meeting(
  start: string,
  end: string,
  state: ClassMeeting["state"] = "SCHEDULED",
  as: ScheduledMeeting["as"] = "STUDENT",
): ScheduledMeeting {
  n += 1;
  return {
    id: `m${String(n)}`,
    title: `Meeting ${String(n)}`,
    scheduledStart: start,
    scheduledEnd: end,
    state,
    as,
  } as ScheduledMeeting;
}

// 09:30 on Tue 13 Oct 2026 in Lagos (UTC+1).
const NOW = new Date("2026-10-13T08:30:00Z");
const LAGOS = "Africa/Lagos";

describe("planToday (handoff §11.2: now first)", () => {
  it("puts open and live classes first, then the rest of today in time order", () => {
    const live = meeting("2026-10-13T08:00:00Z", "2026-10-13T09:00:00Z", "LIVE");
    const afternoon = meeting("2026-10-13T13:00:00Z", "2026-10-13T14:00:00Z");
    const lunch = meeting("2026-10-13T11:00:00Z", "2026-10-13T12:00:00Z");
    const tomorrow = meeting("2026-10-14T08:00:00Z", "2026-10-14T09:00:00Z");
    const plan = planToday([afternoon, tomorrow, live, lunch], NOW, LAGOS);
    expect(plan.happeningNow).toEqual([live]);
    expect(plan.laterToday).toEqual([lunch, afternoon]);
    expect(plan.next).toBeNull();
  });

  it("offers the next class on another day only when nothing is on today", () => {
    const tomorrow = meeting("2026-10-14T08:00:00Z", "2026-10-14T09:00:00Z");
    const later = meeting("2026-10-15T08:00:00Z", "2026-10-15T09:00:00Z");
    const plan = planToday([later, tomorrow], NOW, LAGOS);
    expect(plan.happeningNow).toEqual([]);
    expect(plan.laterToday).toEqual([]);
    expect(plan.next).toEqual(tomorrow);
  });

  it("decides 'today' in the viewer's zone, not UTC", () => {
    // 23:30 UTC on the 13th is 00:30 on the 14th in Lagos: tomorrow there.
    const lateUtc = meeting("2026-10-13T23:30:00Z", "2026-10-14T00:30:00Z");
    expect(planToday([lateUtc], NOW, LAGOS).laterToday).toEqual([]);
    expect(planToday([lateUtc], NOW, "UTC").laterToday).toEqual([lateUtc]);
  });

  it("drops classes that are over, and the ones the person teaches", () => {
    const ended = meeting("2026-10-13T06:00:00Z", "2026-10-13T07:00:00Z", "ENDED");
    const teaching = meeting(
      "2026-10-13T11:00:00Z",
      "2026-10-13T12:00:00Z",
      "SCHEDULED",
      "LECTURER",
    );
    const plan = planToday([ended, teaching], NOW, LAGOS);
    expect(plan).toEqual({ happeningNow: [], laterToday: [], next: null, comingUp: [] });
  });

  it("keeps a class cancelled later today in view, so nobody waits for it", () => {
    const cancelled = meeting("2026-10-13T11:00:00Z", "2026-10-13T12:00:00Z", "CANCELLED");
    expect(planToday([cancelled], NOW, LAGOS).laterToday).toEqual([cancelled]);
  });
});

describe("planToday for a Lecturer (handoff §11.7)", () => {
  it("plans the classes they teach, with everything after today under comingUp", () => {
    const open = meeting("2026-10-13T08:15:00Z", "2026-10-13T09:15:00Z", "OPEN", "LECTURER");
    const later = meeting("2026-10-13T13:00:00Z", "2026-10-13T14:00:00Z", "SCHEDULED", "LECTURER");
    const friday = meeting("2026-10-16T08:00:00Z", "2026-10-16T09:00:00Z", "SCHEDULED", "LECTURER");
    const thursday = meeting(
      "2026-10-15T08:00:00Z",
      "2026-10-15T09:00:00Z",
      "SCHEDULED",
      "LECTURER",
    );
    const attending = meeting("2026-10-13T10:00:00Z", "2026-10-13T11:00:00Z");
    const plan = planToday([friday, attending, later, open, thursday], NOW, LAGOS, "LECTURER");
    expect(plan.happeningNow).toEqual([open]);
    expect(plan.laterToday).toEqual([later]);
    expect(plan.comingUp).toEqual([thursday, friday]);
  });

  it("lists later days under comingUp for a student too", () => {
    const tomorrow = meeting("2026-10-14T08:00:00Z", "2026-10-14T09:00:00Z");
    expect(planToday([tomorrow], NOW, LAGOS).comingUp).toEqual([tomorrow]);
  });
});

describe("byDay (handoff §11.11 Schedule: a week list grouped by day)", () => {
  it("groups both roles' classes by the viewer's day, in time order", () => {
    const late = meeting("2026-10-13T22:30:00Z", "2026-10-13T23:30:00Z"); // 23:30 Tue in Lagos
    const morning = meeting("2026-10-13T08:00:00Z", "2026-10-13T09:00:00Z");
    const teaching = meeting(
      "2026-10-14T09:00:00Z",
      "2026-10-14T10:00:00Z",
      "SCHEDULED",
      "LECTURER",
    );
    const days = byDay([teaching, late, morning], LAGOS);
    expect(days.map((d) => [d.day, d.meetings.map((m) => m.id)])).toEqual([
      ["2026-10-13", [morning.id, late.id]],
      ["2026-10-14", [teaching.id]],
    ]);
  });

  it("puts a class past midnight in the viewer's zone on the next day", () => {
    const m = meeting("2026-10-13T23:30:00Z", "2026-10-14T00:30:00Z"); // 00:30 Wed in Lagos
    expect(byDay([m], LAGOS)[0]?.day).toBe("2026-10-14");
  });
});
