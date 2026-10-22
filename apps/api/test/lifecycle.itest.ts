import type { ClassMeeting } from "@glim/contracts";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { ClassMeetingsService, MeetingLifecycleService } from "@glim/modules/class-meeting";
import { unwrap } from "@glim/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type PersonaName, type Personas } from "./personas";

/**
 * Join, Start, End and the minute tick (TRD §11.4, §11.6; v1 interim). Persona offering O1: taught
 * by l1Primary, l2Co and l3Assistant, taken by sEnrolled (sCompleted has finished it; sOther
 * takes O2). Default JOIN_WINDOW policy: students 15 minutes before to 60 after, staff 60 before,
 * maximum overrun 180 minutes.
 */

let t: TestApp;
let p: Personas;
const MEET = "https://meet.google.com/abc-defg-hij";

interface ErrorBody {
  error: { code: string; message: string };
}

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

/** Moves the clock, with fresh sessions (they last 12 hours). */
async function at(iso: string): Promise<void> {
  t.clock.set(iso);
  for (const name of Object.keys(p).filter((k) => k !== "world") as PersonaName[])
    p[name].headers = await sessionFor(t, p[name].userId);
}

const act = (as: PersonaName, id: string, action: "join" | "start" | "end") =>
  t.request({
    method: "POST",
    url: `/api/v1/class-meetings/${id}/${action}`,
    headers: p[as].headers,
  });

/** A meeting on O1, created as the Academic Admin while the clock is before it. */
async function meeting(start: string, end: string, onlineLink: string | null = MEET) {
  return unwrap(
    await t.app
      .get(ClassMeetingsService)
      .create(
        p.world.offerings.O1,
        { title: `Class at ${start}`, scheduledStart: start, scheduledEnd: end, onlineLink },
        { ...SYSTEM_ACTOR, userId: p.acadAdmin.userId },
      ),
  ).meeting;
}

const stateOf = async (id: string) =>
  (await q<{ state: string }>("SELECT state FROM class_meetings WHERE id = $1", [id])).rows[0]
    ?.state;

beforeAll(async () => {
  t = await createTestApp();
  t.clock.set("2026-11-03T06:00:00Z");
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
});

afterAll(async () => {
  await t.close();
});

describe("joining", () => {
  let m: ClassMeeting;

  beforeAll(async () => {
    m = await meeting("2026-11-03T09:00:00Z", "2026-11-03T11:00:00Z");
  });

  it("gives an enrolled student the link only from 15 minutes before, logging every attempt", async () => {
    await at("2026-11-03T08:44:00Z");
    const early = await act("sEnrolled", m.id, "join");
    expect(early.statusCode).toBe(422);
    expect(early.json<ErrorBody>().error.code).toBe("JOIN_WINDOW_CLOSED");
    expect(early.body).not.toContain("meet.google.com");

    await at("2026-11-03T08:45:00Z");
    const res = await act("sEnrolled", m.id, "join");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      meetingId: m.id,
      state: "SCHEDULED",
      onlineLink: MEET,
      linkSource: "PASTED",
      role: "STUDENT",
      window: { opensAt: "2026-11-03T08:45:00.000Z", closesAt: "2026-11-03T12:00:00.000Z" },
      room: null,
      dialIn: null,
    });
    const log = await q<{ outcome: string; deny_reason: string | null }>(
      "SELECT outcome, deny_reason FROM meeting_join_log WHERE class_meeting_id = $1 ORDER BY created_at",
      [m.id],
    );
    expect(log.rows).toEqual([
      { outcome: "DENIED", deny_reason: "JOIN_WINDOW_CLOSED" },
      { outcome: "AUTHORIZED", deny_reason: null },
    ]);
  });

  it("never gives the link to anyone not enrolled (AC-04)", async () => {
    for (const who of [
      "sOther",
      "sCompleted",
      "sGraduated",
      "noRole",
      "applicant",
      "l4Other",
    ] as const) {
      const res = await act(who, m.id, "join");
      expect([403, 404], who).toContain(res.statusCode);
      expect(res.body, who).not.toContain("meet.google.com");
    }
    const anonymous = await t.request({
      method: "POST",
      url: `/api/v1/class-meetings/${m.id}/join`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it("opens an hour early for the class's Lecturers", async () => {
    await at("2026-11-03T08:00:00Z");
    const res = await act("l3Assistant", m.id, "join");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ role: string }>().role).toBe("STAFF");
    expect((await act("sEnrolled", m.id, "join")).statusCode).toBe(422);
  });

  it("says when the link hasn't been added yet", async () => {
    await at("2026-11-03T06:00:00Z");
    const noLink = await meeting("2026-11-03T13:00:00Z", "2026-11-03T14:00:00Z", null);
    await at("2026-11-03T12:50:00Z");
    const res = await act("sEnrolled", noLink.id, "join");
    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("ONLINE_LINK_NOT_SET");
  });
});

describe("starting and ending", () => {
  let m: ClassMeeting;

  beforeAll(async () => {
    await at("2026-11-04T06:00:00Z");
    m = await meeting("2026-11-04T09:00:00Z", "2026-11-04T11:00:00Z");
  });

  it("lets the class's Lecturers start it from an hour before, with what to do in the room", async () => {
    await at("2026-11-04T07:59:00Z");
    const early = await act("l1Primary", m.id, "start");
    expect(early.json<ErrorBody>().error.code).toBe("JOIN_WINDOW_CLOSED");
    expect([403, 404]).toContain((await act("sEnrolled", m.id, "start")).statusCode);
    expect([403, 404]).toContain((await act("l4Other", m.id, "start")).statusCode);

    await at("2026-11-04T08:30:00Z");
    const res = await act("l3Assistant", m.id, "start");
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{ meeting: ClassMeeting; onlineLink: string; recordingNotice: string }>();
    expect(body.meeting.state).toBe("LIVE");
    expect(body.onlineLink).toBe(MEET);
    expect(body.recordingNotice).toContain("recorded");
    const again = await act("l1Primary", m.id, "start");
    expect(again.statusCode).toBe(409);
    const events = await q<{ n: string }>(
      "SELECT count(*) AS n FROM pgboss.job WHERE name = 'domain-event' AND data->>'name' = 'meeting.started' AND data->'payload'->>'meetingId' = $1",
      [m.id],
    );
    expect(Number(events.rows[0]?.n)).toBe(1);
  });

  it("lets students join a live class even after the usual window", async () => {
    await at("2026-11-04T12:30:00Z");
    const res = await act("sEnrolled", m.id, "join");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ state: string }>().state).toBe("LIVE");
  });

  it("ends the class, and allows a restart within the overrun after an accidental end", async () => {
    const ended = await act("l2Co", m.id, "end");
    expect(ended.statusCode, ended.body).toBe(200);
    expect(ended.json<ClassMeeting>().state).toBe("ENDED");
    expect((await act("l2Co", m.id, "end")).statusCode).toBe(409);
    const restarted = await act("l1Primary", m.id, "start");
    expect(restarted.json<{ meeting: ClassMeeting }>().meeting.state).toBe("LIVE");
    expect((await act("l1Primary", m.id, "end")).statusCode).toBe(200);
    const row = await q<{ first: Date; last: Date }>(
      "SELECT first_conference_started_at AS first, last_conference_ended_at AS last FROM class_meetings WHERE id = $1",
      [m.id],
    );
    expect(row.rows[0]?.first.toISOString()).toBe("2026-11-04T08:30:00.000Z");
    expect(row.rows[0]?.last.toISOString()).toBe("2026-11-04T12:30:00.000Z");
  });

  it("won't start a class that hasn't begun its window or has been cancelled", async () => {
    await at("2026-11-04T06:00:00Z");
    const cancelled = await meeting("2026-11-04T15:00:00Z", "2026-11-04T16:00:00Z");
    await t.request({
      method: "POST",
      url: `/api/v1/class-meetings/${cancelled.id}/cancel`,
      headers: p.l1Primary.headers,
      payload: { reason: "Holiday" },
    });
    await at("2026-11-04T14:30:00Z");
    expect((await act("l1Primary", cancelled.id, "start")).json<ErrorBody>().error.code).toBe(
      "MEETING_STATE_INVALID",
    );
    expect((await act("sEnrolled", cancelled.id, "join")).json<ErrorBody>().error.code).toBe(
      "MEETING_STATE_INVALID",
    );
  });
});

describe("the minute tick", () => {
  it("opens classes, ends overrunning ones and marks no-shows", async () => {
    await at("2026-11-05T06:00:00Z");
    const tick = () => t.app.get(MeetingLifecycleService).tick();
    // The earlier tests' classes that were never started are long past: settle them first.
    expect(await tick()).toEqual({ NO_SHOW: 2 });
    const opens = await meeting("2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z");
    const noShow = await meeting("2026-11-05T07:00:00Z", "2026-11-05T08:00:00Z");
    const overruns = await meeting("2026-11-05T06:30:00Z", "2026-11-05T07:00:00Z");

    await at("2026-11-05T06:20:00Z");
    expect((await act("l1Primary", overruns.id, "start")).statusCode).toBe(200);

    // Both waiting classes are inside the 15-minute window now.
    await at("2026-11-05T08:45:00Z");
    expect(await tick()).toEqual({ OPEN: 2 });
    expect(await stateOf(opens.id)).toBe("OPEN");
    expect(await stateOf(noShow.id)).toBe("OPEN");

    // An hour after its end, the class nobody started didn't take place.
    await at("2026-11-05T09:01:00Z");
    expect(await tick()).toEqual({ NO_SHOW: 1 });
    expect(await stateOf(noShow.id)).toBe("NO_SHOW");

    // Three hours after its end, the live class is ended for the Lecturer.
    await at("2026-11-05T10:01:00Z");
    expect(await tick()).toEqual({ ENDED: 1 });
    expect(await stateOf(overruns.id)).toBe("ENDED");
    expect(await tick()).toEqual({});
  });
});
