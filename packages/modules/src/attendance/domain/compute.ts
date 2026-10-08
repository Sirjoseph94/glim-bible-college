/**
 * `computeAttendance` (TRD §12.5): pure, so it can be tested against the Appendix C vectors.
 * v1 (spec) feeds it roll call only: no conferences, no online intervals. A roll-call mark with
 * mode ONLINE is manual online evidence: PRESENT, ONLINE, 10000 bp, late from the mark.
 */

export interface Interval {
  start: Date;
  /** Null while still open: capped at `capAt`. */
  end: Date | null;
}

export interface RollCallInput {
  present: boolean;
  late: boolean;
  mode: "IN_PERSON" | "ONLINE";
}

export interface AttendancePolicyInput {
  basis: "SCHEDULED" | "ACTUAL" | "ACTUAL_CAPPED";
  presentThresholdBp: number;
  partialThresholdBp: number;
  lateGraceMinutes: number;
  windowPaddingMinutes: { before: number; after: number };
  minSegmentSeconds: number;
  shortConferenceReviewBp: number;
}

export interface AttendanceInput {
  scheduledStart: Date;
  scheduledEnd: Date;
  conferences: Interval[];
  capAt: Date;
  policy: AttendancePolicyInput;
  enrolledStudentIds: string[];
  online: Record<string, Interval[] | undefined>;
  rollCall: Record<string, RollCallInput | undefined>;
}

export type ComputedStatus = "PRESENT" | "PARTIAL" | "ABSENT";
export type AttendanceModeOut = "IN_PERSON" | "ONLINE" | "NONE";

export interface AttendanceResult {
  studentId: string;
  computedStatus: ComputedStatus;
  attendanceMode: AttendanceModeOut;
  attendedSeconds: number;
  /** The denominator used. */
  effectiveSeconds: number;
  ratioBp: number;
  firstJoinAt: Date | null;
  lastLeaveAt: Date | null;
  late: boolean;
  joinCount: number;
}

export interface AttendanceOutcome {
  results: AttendanceResult[];
  /** Step 4: a short conference with students lacking a roll-call mark needs review. */
  shortConference: boolean;
}

type Span = [number, number];

const seconds = (spans: Span[]) => spans.reduce((sum, [a, b]) => sum + (b - a), 0) / 1000;

/** Sorted, non-overlapping union of spans. */
function union(spans: Span[]): Span[] {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last !== undefined && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The parts of `span` inside `within` (itself a union). */
function clip(span: Span, within: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a, b] of within) {
    const from = Math.max(span[0], a);
    const to = Math.min(span[1], b);
    if (to > from) out.push([from, to]);
  }
  return out;
}

export function computeAttendance(input: AttendanceInput): AttendanceOutcome {
  const { policy } = input;
  const minute = 60_000;
  const window: Span = [
    input.scheduledStart.getTime() - policy.windowPaddingMinutes.before * minute,
    input.scheduledEnd.getTime() + policy.windowPaddingMinutes.after * minute,
  ];
  const cap = input.capAt.getTime();
  const toSpan = (i: Interval): Span => [i.start.getTime(), i.end?.getTime() ?? cap];

  // Steps 1–3: the conference inside the window, and the denominator.
  const conference = union(input.conferences.flatMap((c) => clip(toSpan(c), [window])));
  const scheduledSeconds = seconds([window]);
  const actualSeconds = seconds(conference);
  const denominator =
    policy.basis === "SCHEDULED"
      ? scheduledSeconds
      : policy.basis === "ACTUAL"
        ? actualSeconds
        : Math.min(scheduledSeconds, actualSeconds);

  // Step 4.
  const shortConference =
    actualSeconds * 10000 < policy.shortConferenceReviewBp * scheduledSeconds &&
    input.enrolledStudentIds.some((id) => input.rollCall[id] === undefined);

  const lateAfter = input.scheduledStart.getTime() + policy.lateGraceMinutes * minute;
  const results = [...new Set(input.enrolledStudentIds)]
    .sort()
    .map((studentId): AttendanceResult => {
      // Step 5: online evidence.
      const pieces = (input.online[studentId] ?? []).map((interval) =>
        clip(toSpan(interval), conference).filter(
          ([a, b]) => (b - a) / 1000 >= policy.minSegmentSeconds,
        ),
      );
      const joins = pieces.filter((p) => p.length > 0).length;
      const merged = union(pieces.flat());
      const attendedSeconds = seconds(merged);
      const ratioBp =
        denominator > 0 ? Math.min(10000, Math.floor((attendedSeconds * 10000) / denominator)) : 0;
      const onlineStatus: ComputedStatus =
        ratioBp >= policy.presentThresholdBp
          ? "PRESENT"
          : ratioBp >= policy.partialThresholdBp
            ? "PARTIAL"
            : "ABSENT";
      const first = merged[0];
      const last = merged.at(-1);
      const evidence = {
        attendedSeconds,
        effectiveSeconds: denominator,
        firstJoinAt: first === undefined ? null : new Date(first[0]),
        lastLeaveAt: last === undefined ? null : new Date(last[1]),
        joinCount: joins,
      };

      // Step 6: roll call wins when it says present.
      const mark = input.rollCall[studentId];
      if (mark?.present === true)
        return {
          studentId,
          computedStatus: "PRESENT",
          attendanceMode: mark.mode,
          ratioBp: 10000,
          late: mark.late,
          ...evidence,
        };
      if (merged.length > 0)
        return {
          studentId,
          computedStatus: onlineStatus,
          attendanceMode: "ONLINE",
          ratioBp,
          late: first !== undefined && first[0] > lateAfter,
          ...evidence,
        };
      return {
        studentId,
        computedStatus: "ABSENT",
        attendanceMode: "NONE",
        ratioBp: 0,
        late: false,
        ...evidence,
      };
    });
  return { results, shortConference };
}
