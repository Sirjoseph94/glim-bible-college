import type { ClassMeetingState, ErrorCode } from "@glim/contracts";

/**
 * The Class Meeting state machine (TRD §11.4), with the v1 interim triggers (spec): the
 * Lecturer's Start and End, and the `meeting-tick` cron. `state` models only the class's
 * lifecycle; no provider events exist in this slice.
 */
export type MeetingEvent =
  /** The join window opened (tick). */
  | "WINDOW_OPENED"
  /** The Lecturer started the class (or restarted it after an accidental end). */
  | "START"
  /** The Lecturer ended the class. */
  | "END"
  /** The tick found a live class past its maximum overrun. */
  | "OVERRUN"
  /** The tick found the join window closed on a class that never started. */
  | "WINDOW_CLOSED"
  | "CANCEL";

export interface MeetingContext {
  /** The class was started at least once. */
  everStarted: boolean;
  /** Roll call has marks (then a class that never went online still took place). */
  hasRollCall: boolean;
  /** Now is within `scheduled_end + maxOverrun` (a restart is still allowed). */
  withinOverrun: boolean;
  finalized: boolean;
}

export type Transition =
  { ok: true; to: ClassMeetingState } | { ok: false; code: ErrorCode; message: string };

const to = (state: ClassMeetingState): Transition => ({ ok: true, to: state });
const refuse = (message: string, code: ErrorCode = "MEETING_STATE_INVALID"): Transition => ({
  ok: false,
  code,
  message,
});

export function transition(
  state: ClassMeetingState,
  event: MeetingEvent,
  ctx: MeetingContext,
): Transition {
  switch (event) {
    case "WINDOW_OPENED":
      return state === "SCHEDULED" ? to("OPEN") : refuse("Only a scheduled class opens.");
    case "START":
      if (state === "SCHEDULED" || state === "OPEN") return to("LIVE");
      if (state === "ENDED" && ctx.withinOverrun && !ctx.finalized) return to("LIVE");
      if (state === "LIVE") return refuse("The class has already started.");
      return refuse(`This class is ${label(state)}; it can't start.`);
    case "END":
      if (state === "LIVE") return to("ENDED");
      // Roll call taken but the class never went online (e.g. no internet in the room).
      if ((state === "SCHEDULED" || state === "OPEN") && ctx.hasRollCall) return to("ENDED");
      return refuse(
        state === "SCHEDULED" || state === "OPEN"
          ? "Start the class first, or take roll call."
          : `This class is ${label(state)}; it can't end.`,
      );
    case "OVERRUN":
      return state === "LIVE" ? to("ENDED") : refuse("Only a live class overruns.");
    case "WINDOW_CLOSED":
      if (state !== "SCHEDULED" && state !== "OPEN")
        return refuse("The class isn't waiting to start.");
      return !ctx.everStarted && !ctx.hasRollCall ? to("NO_SHOW") : to("ENDED");
    case "CANCEL":
      if (state === "SCHEDULED" || state === "OPEN") return to("CANCELLED");
      if (state === "LIVE")
        return refuse("This class is live; end it instead.", "MEETING_IN_PROGRESS");
      return refuse(`This class is ${label(state)}; it can't be cancelled.`);
  }
}

function label(state: ClassMeetingState): string {
  return state === "NO_SHOW" ? "marked as not having taken place" : state.toLowerCase();
}

export interface TickInput {
  state: ClassMeetingState;
  start: Date;
  end: Date;
  now: Date;
  /** From the meeting's JOIN_WINDOW policy snapshot. */
  studentOpensBeforeMinutes: number;
  studentClosesAfterMinutes: number;
  maxOverrunMinutes: number;
}

/** Which event, if any, the minute tick raises for a meeting (spec: interim triggers). */
export function tickEvent(input: TickInput): MeetingEvent | null {
  const at = input.now.getTime();
  const min = 60_000;
  if (input.state === "LIVE")
    return at > input.end.getTime() + input.maxOverrunMinutes * min ? "OVERRUN" : null;
  if (input.state !== "SCHEDULED" && input.state !== "OPEN") return null;
  if (at > input.end.getTime() + input.studentClosesAfterMinutes * min) return "WINDOW_CLOSED";
  if (
    input.state === "SCHEDULED" &&
    at >= input.start.getTime() - input.studentOpensBeforeMinutes * min
  )
    return "WINDOW_OPENED";
  return null;
}
