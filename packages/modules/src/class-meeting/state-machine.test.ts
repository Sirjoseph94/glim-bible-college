import { CLASS_MEETING_STATES, type ClassMeetingState } from "@glim/contracts";
import { describe, expect, it } from "vitest";
import { tickEvent, transition, type MeetingContext, type MeetingEvent } from "./state-machine";

const EVENTS: MeetingEvent[] = [
  "WINDOW_OPENED",
  "START",
  "END",
  "OVERRUN",
  "WINDOW_CLOSED",
  "CANCEL",
  "CONFERENCE_STARTED",
  "CONFERENCE_ENDED",
];
const base: MeetingContext = {
  everStarted: false,
  hasRollCall: false,
  withinOverrun: true,
  finalized: false,
};

/** Every state × event, with the context that matters noted. `null` means refused. */
const TABLE: Record<ClassMeetingState, Record<MeetingEvent, ClassMeetingState | null>> = {
  SCHEDULED: {
    WINDOW_OPENED: "OPEN",
    START: "LIVE",
    END: null,
    OVERRUN: null,
    WINDOW_CLOSED: "NO_SHOW",
    CANCEL: "CANCELLED",
    CONFERENCE_STARTED: "LIVE",
    CONFERENCE_ENDED: null,
  },
  OPEN: {
    WINDOW_OPENED: null,
    START: "LIVE",
    END: null,
    OVERRUN: null,
    WINDOW_CLOSED: "NO_SHOW",
    CANCEL: "CANCELLED",
    CONFERENCE_STARTED: "LIVE",
    CONFERENCE_ENDED: null,
  },
  LIVE: {
    WINDOW_OPENED: null,
    START: null,
    END: "ENDED",
    OVERRUN: "ENDED",
    WINDOW_CLOSED: null,
    CANCEL: null,
    CONFERENCE_STARTED: null,
    CONFERENCE_ENDED: "ENDED",
  },
  ENDED: {
    WINDOW_OPENED: null,
    START: "LIVE",
    END: null,
    OVERRUN: null,
    WINDOW_CLOSED: null,
    CANCEL: null,
    CONFERENCE_STARTED: "LIVE",
    CONFERENCE_ENDED: null,
  },
  CANCELLED: {
    WINDOW_OPENED: null,
    START: null,
    END: null,
    OVERRUN: null,
    WINDOW_CLOSED: null,
    CANCEL: null,
    CONFERENCE_STARTED: null,
    CONFERENCE_ENDED: null,
  },
  NO_SHOW: {
    WINDOW_OPENED: null,
    START: null,
    END: null,
    OVERRUN: null,
    WINDOW_CLOSED: null,
    CANCEL: null,
    CONFERENCE_STARTED: null,
    CONFERENCE_ENDED: null,
  },
};

describe("transition (default context: never started, no roll call, within overrun)", () => {
  for (const state of CLASS_MEETING_STATES)
    for (const event of EVENTS)
      it(`${state} + ${event} → ${TABLE[state][event] ?? "refused"}`, () => {
        const result = transition(state, event, base);
        const expected = TABLE[state][event];
        if (expected === null) expect(result.ok).toBe(false);
        else expect(result).toEqual({ ok: true, to: expected });
      });
});

describe("transition: context", () => {
  it("ends a class that never went online once roll call was taken", () => {
    const ctx = { ...base, hasRollCall: true };
    expect(transition("OPEN", "END", ctx)).toEqual({ ok: true, to: "ENDED" });
    expect(transition("SCHEDULED", "WINDOW_CLOSED", ctx)).toEqual({ ok: true, to: "ENDED" });
  });

  it("ends rather than no-shows a class that was started once", () => {
    expect(transition("OPEN", "WINDOW_CLOSED", { ...base, everStarted: true })).toEqual({
      ok: true,
      to: "ENDED",
    });
  });

  it("allows a restart only within the overrun and before finalization", () => {
    expect(transition("ENDED", "START", { ...base, withinOverrun: false }).ok).toBe(false);
    expect(transition("ENDED", "START", { ...base, finalized: true }).ok).toBe(false);
  });

  it("goes live again when a new call starts within the overrun, before finalization", () => {
    expect(transition("ENDED", "CONFERENCE_STARTED", { ...base, withinOverrun: false }).ok).toBe(
      false,
    );
    expect(transition("ENDED", "CONFERENCE_STARTED", { ...base, finalized: true }).ok).toBe(false);
  });

  it("refuses to cancel a live class with MEETING_IN_PROGRESS", () => {
    expect(transition("LIVE", "CANCEL", base)).toMatchObject({
      ok: false,
      code: "MEETING_IN_PROGRESS",
    });
  });
});

describe("tickEvent", () => {
  const start = new Date("2080-09-07T09:00:00Z");
  const end = new Date("2080-09-07T11:00:00Z");
  const policy = {
    studentOpensBeforeMinutes: 15,
    studentClosesAfterMinutes: 60,
    maxOverrunMinutes: 180,
  };
  const at = (iso: string, state: ClassMeetingState) =>
    tickEvent({ state, start, end, now: new Date(iso), ...policy });

  it("opens a scheduled class 15 minutes before it starts", () => {
    expect(at("2080-09-07T08:44:00Z", "SCHEDULED")).toBeNull();
    expect(at("2080-09-07T08:45:00Z", "SCHEDULED")).toBe("WINDOW_OPENED");
    expect(at("2080-09-07T08:50:00Z", "OPEN")).toBeNull();
  });

  it("closes the window an hour after the end", () => {
    expect(at("2080-09-07T12:00:00Z", "OPEN")).toBeNull();
    expect(at("2080-09-07T12:01:00Z", "OPEN")).toBe("WINDOW_CLOSED");
    expect(at("2080-09-07T12:01:00Z", "SCHEDULED")).toBe("WINDOW_CLOSED");
  });

  it("ends a live class after the maximum overrun", () => {
    expect(at("2080-09-07T14:00:00Z", "LIVE")).toBeNull();
    expect(at("2080-09-07T14:01:00Z", "LIVE")).toBe("OVERRUN");
  });

  it("leaves finished classes alone", () => {
    for (const state of ["ENDED", "CANCELLED", "NO_SHOW"] as const)
      expect(at("2080-09-08T00:00:00Z", state)).toBeNull();
  });
});
