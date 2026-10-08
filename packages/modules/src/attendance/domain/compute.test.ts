import { describe, expect, it } from "vitest";
import {
  computeAttendance,
  type AttendanceInput,
  type Interval,
  type RollCallInput,
} from "./compute";

/** Appendix C.1: default policy, meeting 10:00–11:00. */
const T = (hhmm: string) => new Date(`2080-09-07T${hhmm}:00Z`);
const span = (from: string, to: string | null): Interval => ({
  start: T(from),
  end: to === null ? null : T(to),
});
const policy = {
  basis: "ACTUAL_CAPPED" as const,
  presentThresholdBp: 7500,
  partialThresholdBp: 2500,
  lateGraceMinutes: 15,
  windowPaddingMinutes: { before: 0, after: 0 },
  minSegmentSeconds: 0,
  shortConferenceReviewBp: 3000,
};

function run(
  conference: Interval[],
  students: Record<string, { online?: Interval[]; mark?: RollCallInput }>,
  capAt = T("11:00"),
) {
  const input: AttendanceInput = {
    scheduledStart: T("10:00"),
    scheduledEnd: T("11:00"),
    conferences: conference,
    capAt,
    policy,
    enrolledStudentIds: Object.keys(students),
    online: Object.fromEntries(Object.entries(students).map(([id, s]) => [id, s.online])),
    rollCall: Object.fromEntries(Object.entries(students).map(([id, s]) => [id, s.mark])),
  };
  return computeAttendance(input);
}

const main = [span("10:02", "11:00")];
const one = (id: string, s: { online?: Interval[]; mark?: RollCallInput }, conf = main) => {
  const out = run(conf, { [id]: s });
  const result = out.results[0];
  if (result === undefined) throw new Error("no result");
  return { ...result, shortConference: out.shortConference };
};
const present = (mode: "IN_PERSON" | "ONLINE", late = false): RollCallInput => ({
  present: true,
  late,
  mode,
});

describe("Appendix C.1 attendance vectors", () => {
  it("V1: online 10:05→11:00 of a 10:02–11:00 conference", () => {
    expect(one("A", { online: [span("10:05", "11:00")] })).toMatchObject({
      effectiveSeconds: 3480,
      attendedSeconds: 3300,
      ratioBp: 9482,
      computedStatus: "PRESENT",
      attendanceMode: "ONLINE",
      late: false,
      joinCount: 1,
    });
  });

  it("V2: two stretches", () => {
    expect(one("B", { online: [span("10:02", "10:30"), span("10:40", "11:00")] })).toMatchObject({
      attendedSeconds: 2880,
      ratioBp: 8275,
      computedStatus: "PRESENT",
      late: false,
      joinCount: 2,
    });
  });

  it("V3: two devices overlapping count once", () => {
    expect(one("C", { online: [span("10:02", "10:40"), span("10:30", "11:00")] })).toMatchObject({
      attendedSeconds: 3480,
      ratioBp: 10000,
      computedStatus: "PRESENT",
      joinCount: 2,
    });
  });

  it("V4: partial and late", () => {
    expect(one("D", { online: [span("10:20", "10:50")] })).toMatchObject({
      attendedSeconds: 1800,
      ratioBp: 5172,
      computedStatus: "PARTIAL",
      attendanceMode: "ONLINE",
      late: true,
      joinCount: 1,
    });
  });

  it("V5: too little is absent, but online", () => {
    expect(one("E", { online: [span("10:50", "11:00")] })).toMatchObject({
      attendedSeconds: 600,
      ratioBp: 1724,
      computedStatus: "ABSENT",
      attendanceMode: "ONLINE",
      late: true,
      joinCount: 1,
    });
  });

  it("V6: no evidence and no mark", () => {
    expect(one("F", {})).toMatchObject({
      effectiveSeconds: 3480,
      attendedSeconds: 0,
      ratioBp: 0,
      computedStatus: "ABSENT",
      attendanceMode: "NONE",
      late: false,
      joinCount: 0,
    });
  });

  it("V7: no end recorded, capped by the conference's end", () => {
    expect(one("G", { online: [span("10:30", null)] }, main)).toMatchObject({
      attendedSeconds: 1800,
      ratioBp: 5172,
      computedStatus: "PARTIAL",
      late: true,
      joinCount: 1,
    });
    // Even if the cap is later than the conference.
    expect(
      run(main, { G: { online: [span("10:30", null)] } }, T("12:00")).results[0],
    ).toMatchObject({ attendedSeconds: 1800 });
  });

  it("V8: the window clips an early conference and early joiner", () => {
    expect(one("H", { online: [span("09:50", "10:30")] }, [span("09:50", "11:00")])).toMatchObject({
      effectiveSeconds: 3600,
      attendedSeconds: 1800,
      ratioBp: 5000,
      computedStatus: "PARTIAL",
      late: false,
      joinCount: 1,
    });
  });

  it("V9: a short conference flags review when someone has no roll-call mark", () => {
    expect(one("I", { online: [span("10:00", "10:10")] }, [span("10:00", "10:10")])).toMatchObject({
      effectiveSeconds: 600,
      attendedSeconds: 600,
      ratioBp: 10000,
      computedStatus: "PRESENT",
      shortConference: true,
    });
  });

  it("V10: the present threshold is inclusive", () => {
    const full = [span("10:00", "11:00")];
    const at2700 = run(full, {
      X: { online: [{ start: T("10:00"), end: new Date(T("10:00").getTime() + 2700_000) }] },
    }).results[0];
    const at2699 = run(full, {
      Y: { online: [{ start: T("10:00"), end: new Date(T("10:00").getTime() + 2699_000) }] },
    }).results[0];
    expect(at2700).toMatchObject({
      effectiveSeconds: 3600,
      ratioBp: 7500,
      computedStatus: "PRESENT",
    });
    expect(at2699).toMatchObject({ ratioBp: 7497, computedStatus: "PARTIAL" });
  });

  it("V11: roll call present with no Meet evidence", () => {
    expect(one("J", { mark: present("IN_PERSON") })).toMatchObject({
      effectiveSeconds: 3480,
      attendedSeconds: 0,
      ratioBp: 10000,
      computedStatus: "PRESENT",
      attendanceMode: "IN_PERSON",
      late: false,
      joinCount: 0,
    });
  });

  it("V12: roll call absent, but online the whole time", () => {
    expect(
      one("K", {
        mark: { present: false, late: false, mode: "IN_PERSON" },
        online: [span("10:05", "11:00")],
      }),
    ).toMatchObject({
      attendedSeconds: 3300,
      ratioBp: 9482,
      computedStatus: "PRESENT",
      attendanceMode: "ONLINE",
      late: false,
      joinCount: 1,
    });
  });

  it("V13: roll call present and late, also online for a while", () => {
    expect(
      one("L", { mark: present("IN_PERSON", true), online: [span("10:30", "11:00")] }),
    ).toMatchObject({
      attendedSeconds: 1800,
      ratioBp: 10000,
      computedStatus: "PRESENT",
      attendanceMode: "IN_PERSON",
      late: true,
      joinCount: 1,
    });
  });

  it("V14: no conference at all; roll call decides, and review is flagged", () => {
    const out = run([], { M: { mark: present("IN_PERSON") }, N: {} });
    expect(out.shortConference).toBe(true);
    expect(out.results).toEqual([
      expect.objectContaining({
        studentId: "M",
        effectiveSeconds: 0,
        ratioBp: 10000,
        computedStatus: "PRESENT",
        attendanceMode: "IN_PERSON",
        joinCount: 0,
      }),
      expect.objectContaining({
        studentId: "N",
        ratioBp: 0,
        computedStatus: "ABSENT",
        attendanceMode: "NONE",
      }),
    ]);
  });
});

describe("v1: online roll-call marks (spec)", () => {
  it("V1 by hand: an ONLINE mark is PRESENT online at 10000 bp, with no conference data", () => {
    const out = run([], { A: { mark: present("ONLINE") } });
    expect(out.results[0]).toMatchObject({
      computedStatus: "PRESENT",
      attendanceMode: "ONLINE",
      ratioBp: 10000,
      late: false,
    });
  });

  it("takes late from an online mark", () => {
    expect(run([], { A: { mark: present("ONLINE", true) } }).results[0]?.late).toBe(true);
  });

  it("doesn't need review when everyone has a mark", () => {
    expect(
      run([], {
        A: { mark: present("ONLINE") },
        B: { mark: { present: false, late: false, mode: "IN_PERSON" } },
      }).shortConference,
    ).toBe(false);
  });

  it("returns students sorted by id, once each", () => {
    const out = run(main, { b: {}, a: {}, c: {} });
    expect(out.results.map((r) => r.studentId)).toEqual(["a", "b", "c"]);
  });
});
