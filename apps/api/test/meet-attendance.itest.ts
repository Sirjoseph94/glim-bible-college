import type { ClassMeeting, MeetingAttendance, Participant, QueueName } from "@glim/contracts";
import { drainQueues } from "@glim/db/testing";
import { FakeLiveProvider } from "@glim/integrations/live-provider/fake";
import { MeetWorld } from "@glim/integrations/live-provider/world";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { ClassMeetingsService, MeetEventsService } from "@glim/modules/class-meeting";
import { InboxService } from "@glim/modules/ops";
import { unwrap } from "@glim/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandlers } from "../../worker/src/handlers";
import { createSubscribers } from "../../worker/src/subscribers";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type PersonaName, type Personas } from "./personas";

/**
 * Online attendance from Meet (TRD §12.1, §12.4–12.6; integration slice), with the worker's own
 * handlers and subscribers over the in-memory Meet. O1: Lecturer l1Primary, student sEnrolled,
 * whose Google account (sub 111, "Ada Student") is linked. Default policy: present ≥ 75 %,
 * review when someone unidentified is in the call for over 10 minutes; matching in review mode.
 */

let t: TestApp;
let p: Personas;
let world: MeetWorld;
let provider: FakeLiveProvider;
let handlers: ReturnType<typeof createHandlers>;
/** sEnrolled's student record. */
let ada: string;
const HOST = "lms-host-01@glim.test";

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

async function at(iso: string): Promise<void> {
  t.clock.set(iso);
  for (const name of ["l1Primary", "sEnrolled", "sysAdmin", "l4Other"] as PersonaName[])
    p[name].headers = await sessionFor(t, p[name].userId);
}

/** Pulls Meet's events into the inbox, then runs every queued job, as the worker would. */
async function settle(): Promise<void> {
  const pulled = await provider.pullEvents(100);
  await t.app.get(InboxService).receive(
    "google_meet",
    pulled.map((x) => t.app.get(MeetEventsService).toInbox(x.envelope)),
  );
  await provider.ackEvents(pulled.map((x) => x.ackId));
  const run = Object.fromEntries(
    (Object.keys(handlers) as QueueName[])
      .filter((queue) => !queue.startsWith("db.") && queue !== "ops.queue-health")
      .map((queue) => [queue, handlers[queue]]),
  );
  await drainQueues(t.boss, run, { ignoreStartAfter: true, maxRounds: 200 });
}

/** A class on O1 with its Meet space, and a call from `from` to `to`. */
async function classWithCall(day: string, call: { from: string; to: string }) {
  await at(`${day}T06:00:00Z`);
  const meeting: ClassMeeting = unwrap(
    await t.app.get(ClassMeetingsService).create(
      p.world.offerings.O1,
      {
        title: `Class ${day}`,
        scheduledStart: `${day}T09:00:00Z`,
        scheduledEnd: `${day}T10:00:00Z`,
      },
      { ...SYSTEM_ACTOR, userId: p.acadAdmin.userId },
    ),
  ).meeting;
  await settle();
  const spaceId = (
    await q<{ s: string }>("SELECT provider_space_id AS s FROM class_meetings WHERE id = $1", [
      meeting.id,
    ])
  ).rows[0]?.s;
  world.dropPending();
  const conferenceId = world.startConference(spaceId ?? "", new Date(`${day}T${call.from}:00Z`));
  return {
    meeting,
    conferenceId,
    end: () => {
      world.endConference(conferenceId, new Date(`${day}T${call.to}:00Z`));
    },
  };
}

/** Ada's (sEnrolled's) attendance record for a class. */
const adaIn = async (meetingId: string) =>
  (
    await t.request({
      url: `/api/v1/class-meetings/${meetingId}/attendance`,
      headers: p.l1Primary.headers,
    })
  )
    .json<MeetingAttendance>()
    .records.find((r) => r.studentId === ada);

const participants = async (meetingId: string, as: PersonaName = "l1Primary") =>
  t.request({ url: `/api/v1/class-meetings/${meetingId}/participants`, headers: p[as].headers });

const match = (meetingId: string, pid: string, userId: string | null, remember = false) =>
  t.request({
    method: "POST",
    url: `/api/v1/class-meetings/${meetingId}/participants/${pid}/match`,
    headers: p.l1Primary.headers,
    payload: { userId, remember },
  });

beforeAll(async () => {
  world = new MeetWorld(() => t.clock.now());
  provider = new FakeLiveProvider(world);
  t = await createTestApp({ liveProvider: provider });
  t.clock.set("2026-11-02T06:00:00Z");
  p = await createPersonas(t);
  handlers = createHandlers({ context: t.app, subscribers: createSubscribers(t.app) });
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  await q("INSERT INTO provider_host_accounts (email, provider_user_id) VALUES ($1, $2)", [
    HOST,
    world.host(HOST).userId,
  ]);
  ada =
    (await q<{ id: string }>("SELECT id FROM students WHERE user_id = $1", [p.sEnrolled.userId]))
      .rows[0]?.id ?? "";
  await q(
    `INSERT INTO identities (user_id, provider, subject, email, metadata)
     VALUES ($1, 'google', '111', 'ada.student@gmail.com', '{"googleName": "Ada Student"}')`,
    [p.sEnrolled.userId],
  );
});

afterAll(async () => {
  await t.close();
});

describe("review mode (S-01 not yet passed)", () => {
  let m: ClassMeeting;

  it("keeps every session, only suggests a name match, and asks the Lecturer to review", async () => {
    const c = await classWithCall("2026-11-03", { from: "09:00", to: "10:00" });
    m = c.meeting;
    world.addSession(c.conferenceId, {
      participantId: "ada",
      providerUserId: "users/111",
      displayName: "Ada Student",
      startedAt: new Date("2026-11-03T09:02:00Z"),
      endedAt: new Date("2026-11-03T09:58:00Z"),
    });
    world.addSession(c.conferenceId, {
      participantId: "laptop",
      providerUserId: "users/500",
      displayName: "Room 1 (Lecturer)",
      startedAt: new Date("2026-11-03T09:00:00Z"),
    });
    world.addSession(c.conferenceId, {
      participantId: "guest",
      kind: "ANONYMOUS",
      displayName: "Guest",
      startedAt: new Date("2026-11-03T09:10:00Z"),
      endedAt: new Date("2026-11-03T09:30:00Z"),
    });
    world.addSession(c.conferenceId, {
      participantId: "phone",
      kind: "PHONE",
      displayName: "+234 *** 12",
      startedAt: new Date("2026-11-03T09:05:00Z"),
      endedAt: new Date("2026-11-03T09:07:00Z"),
    });
    await at("2026-11-03T10:01:00Z");
    c.end();
    await settle();

    const meeting = (
      await q<{ state: string; attendance_state: string }>(
        "SELECT state, attendance_state FROM class_meetings WHERE id = $1",
        [m.id],
      )
    ).rows[0];
    expect(meeting).toEqual({ state: "ENDED", attendance_state: "REVIEW_REQUIRED" });
    const list = (await participants(m.id)).json<{ items: Participant[] }>().items;
    expect(list.map((x) => [x.participantId, x.kind, x.match.status, x.match.method])).toEqual([
      ["laptop", "SIGNED_IN", "UNMATCHED", "NONE"],
      ["ada", "SIGNED_IN", "SUGGESTED", "NAME_ASSISTED"],
      ["phone", "PHONE", "UNMATCHED", "NONE"],
      ["guest", "ANONYMOUS", "UNMATCHED", "NONE"],
    ]);
    expect(list.find((x) => x.participantId === "ada")?.match.userId).toBe(p.sEnrolled.userId);
    // A suggestion isn't counted.
    expect((await adaIn(m.id))?.status).toBe("ABSENT");
    const tasks = await q<{ user_id: string }>(
      "SELECT user_id FROM notifications WHERE kind = 'attendance.review-required' AND data->>'meetingId' = $1",
      [m.id],
    );
    expect(tasks.rows.map((r) => r.user_id)).toContain(p.l1Primary.userId);
  });

  it("only lets people who manage the course's attendance see or resolve participants", async () => {
    expect((await participants(m.id, "sEnrolled")).statusCode).toBe(404);
    expect((await participants(m.id, "l4Other")).statusCode).toBe(404);
    const outsider = await match(m.id, "ada", p.sOther.userId);
    expect(outsider.statusCode).toBe(400);
  });

  it("counts a student once confirmed, and is final once everyone is resolved", async () => {
    const confirmed = await match(m.id, "ada", p.sEnrolled.userId, true);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json<Participant>().match).toMatchObject({
      method: "MANUAL",
      status: "CONFIRMED",
      role: "STUDENT",
    });
    expect((await match(m.id, "laptop", p.l1Primary.userId, true)).statusCode).toBe(200);
    expect((await match(m.id, "guest", null)).statusCode).toBe(200);
    await settle();
    let state = (
      await q<{ s: string }>("SELECT attendance_state AS s FROM class_meetings WHERE id = $1", [
        m.id,
      ])
    ).rows[0]?.s;
    // The phone caller was in for 2 minutes: under the 10-minute review threshold.
    expect(state).toBe("FINAL");
    const record = await adaIn(m.id);
    // 56 of 60 minutes online.
    expect(record).toMatchObject({ status: "PRESENT", mode: "ONLINE", ratioBp: 9333 });
    const audit = await q<{ c: number }>(
      "SELECT count(*)::int AS c FROM audit_logs WHERE action = 'attendance.participant.matched' AND resource_id = $1",
      [m.id],
    );
    expect(audit.rows[0]?.c).toBe(3);
    state = (
      await q<{ s: string }>(
        "SELECT count(*)::text AS s FROM participant_aliases WHERE provider_user_id IN ('111', '500')",
      )
    ).rows[0]?.s;
    expect(state).toBe("2");
  });

  it("matches remembered Meet ids in later classes, and leaves the Lecturer's laptop uncounted", async () => {
    const c = await classWithCall("2026-11-04", { from: "09:00", to: "10:00" });
    world.addSession(c.conferenceId, {
      participantId: "ada",
      providerUserId: "users/111",
      displayName: "Ada S",
      startedAt: new Date("2026-11-04T09:20:00Z"),
      endedAt: new Date("2026-11-04T09:40:00Z"),
    });
    world.addSession(c.conferenceId, {
      participantId: "laptop",
      providerUserId: "users/500",
      displayName: "Room 1",
      startedAt: new Date("2026-11-04T09:00:00Z"),
    });
    await at("2026-11-04T10:01:00Z");
    c.end();
    await settle();
    const list = (await participants(c.meeting.id)).json<{ items: Participant[] }>().items;
    expect(
      list.map((x) => [x.participantId, x.match.method, x.match.status, x.match.role]),
    ).toEqual([
      ["laptop", "GOOGLE_ID", "CONFIRMED", "LECTURER"],
      ["ada", "GOOGLE_ID", "CONFIRMED", "STUDENT"],
    ]);
    const record = await adaIn(c.meeting.id);
    // 20 of 60 minutes (partial from 25 %), joined 20 minutes in (late after 15).
    expect(record).toMatchObject({ status: "PARTIAL", mode: "ONLINE", ratioBp: 3333, late: true });
    expect(
      (
        await q<{ s: string }>("SELECT attendance_state AS s FROM class_meetings WHERE id = $1", [
          c.meeting.id,
        ])
      ).rows[0]?.s,
    ).toBe("FINAL");
  });
});

describe("matching by Google id once S-01 passes", () => {
  it("matches the Meet id to the sign-in subject", async () => {
    await q("DELETE FROM participant_aliases");
    const current = await t.request({
      url: "/api/v1/policies/GOOGLE_MEET",
      headers: p.sysAdmin.headers,
    });
    const { version, config } = current.json<{
      version: number;
      config: Record<string, unknown>;
    }>();
    const saved = await t.request({
      method: "PUT",
      url: "/api/v1/policies/GOOGLE_MEET",
      headers: { ...p.sysAdmin.headers, "if-match": `"${String(version)}"` },
      payload: {
        config: { ...config, matching: { googleId: true, memberEmail: false, nameAssisted: true } },
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const c = await classWithCall("2026-11-05", { from: "09:00", to: "10:00" });
    world.addSession(c.conferenceId, {
      participantId: "ada",
      providerUserId: "users/111",
      displayName: "Someone Else",
      startedAt: new Date("2026-11-05T09:00:00Z"),
      endedAt: new Date("2026-11-05T10:00:00Z"),
    });
    await at("2026-11-05T10:01:00Z");
    c.end();
    await settle();
    expect(await adaIn(c.meeting.id)).toMatchObject({
      status: "PRESENT",
      mode: "ONLINE",
      ratioBp: 10000,
    });
  });
});

describe("roll call and Meet together (C-26)", () => {
  it("counts a student marked present in the room as in person, whatever Meet saw", async () => {
    const c = await classWithCall("2026-11-06", { from: "09:00", to: "10:00" });
    await at("2026-11-06T09:05:00Z");
    const marked = await t.request({
      method: "PUT",
      url: `/api/v1/class-meetings/${c.meeting.id}/roll-call`,
      headers: { ...p.l1Primary.headers, "if-match": '"0"' },
      payload: { marks: [{ studentId: ada, present: true, late: false, mode: "IN_PERSON" }] },
    });
    expect(marked.statusCode, marked.body).toBe(200);
    await at("2026-11-06T10:01:00Z");
    c.end();
    await settle();
    expect(await adaIn(c.meeting.id)).toMatchObject({
      status: "PRESENT",
      mode: "IN_PERSON",
    });
  });

  it("asks for review when the call was much shorter than the class and nobody took roll call", async () => {
    const c = await classWithCall("2026-11-07", { from: "09:00", to: "09:10" });
    await at("2026-11-07T10:30:00Z");
    c.end();
    await settle();
    expect(
      (
        await q<{ s: string }>("SELECT attendance_state AS s FROM class_meetings WHERE id = $1", [
          c.meeting.id,
        ])
      ).rows[0]?.s,
    ).toBe("REVIEW_REQUIRED");
  });
});
