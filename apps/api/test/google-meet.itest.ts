import type { ClassMeeting } from "@glim/contracts";
import { drainQueues } from "@glim/db/testing";
import { FakeLiveProvider } from "@glim/integrations/live-provider/fake";
import { MeetWorld } from "@glim/integrations/live-provider/world";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { ClassMeetingsService, ProvisioningService } from "@glim/modules/class-meeting";
import { unwrap } from "@glim/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type PersonaName, type Personas } from "./personas";

/**
 * Google Meet provisioning, member sync and join (TRD §11.2, §11.5, §11.6; integration slice),
 * with the in-memory Meet. Persona offering O1: Lecturers l1Primary, l2Co, l3Assistant; student
 * sEnrolled.
 */

let t: TestApp;
let p: Personas;
let world: MeetWorld;
const HOST_1 = "lms-host-01@glim.test";
const HOST_2 = "lms-host-02@glim.test";
const STUDENT_GMAIL = "ada.student@gmail.com";

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

async function at(iso: string): Promise<void> {
  t.clock.set(iso);
  for (const name of Object.keys(p).filter((k) => k !== "world") as PersonaName[])
    p[name].headers = await sessionFor(t, p[name].userId);
}

const provisioning = () => t.app.get(ProvisioningService);

/** Runs the Google Meet jobs, including ones scheduled for later and retries. */
const runJobs = () =>
  drainQueues(
    t.boss,
    {
      "class-meeting.provision": (job) =>
        provisioning().provision((job.data as { meetingId: string }).meetingId, {
          final: job.retryCount >= 6,
        }),
      "class-meeting.sync-access": (job) =>
        provisioning().syncAccess((job.data as { meetingId: string }).meetingId),
      "class-meeting.end": (job) =>
        provisioning().endConference((job.data as { meetingId: string }).meetingId),
    },
    { ignoreStartAfter: true, maxRounds: 100 },
  );

async function meeting(
  start: string,
  end: string,
  extra: { onlineLink?: string | null; offering?: "O1" | "O2" } = {},
): Promise<ClassMeeting> {
  return unwrap(
    await t.app.get(ClassMeetingsService).create(
      p.world.offerings[extra.offering ?? "O1"],
      {
        title: `Class at ${start}`,
        scheduledStart: start,
        scheduledEnd: end,
        onlineLink: extra.onlineLink ?? null,
      },
      { ...SYSTEM_ACTOR, userId: p.acadAdmin.userId },
    ),
  ).meeting;
}

const row = async (id: string) =>
  (
    await q<{
      provider: string | null;
      provider_status: string | null;
      join_url: string | null;
      provider_space_id: string | null;
      host_email: string | null;
      provision_error: string | null;
      access_synced_at: Date | null;
    }>(
      `SELECT m.provider, m.provider_status, m.join_url, m.provider_space_id, h.email::text AS host_email,
              m.provision_error, m.access_synced_at
         FROM class_meetings m LEFT JOIN provider_host_accounts h ON h.id = m.host_account_id
        WHERE m.id = $1`,
      [id],
    )
  ).rows[0];

const provisionJobs = async (id: string) =>
  (
    await q<{ start_after: Date; priority: number; state: string }>(
      `SELECT start_after, priority, state FROM pgboss.job
        WHERE name = 'class-meeting.provision' AND data->>'meetingId' = $1 ORDER BY created_on`,
      [id],
    )
  ).rows;

const act = (as: PersonaName, id: string, action: string) =>
  t.request({
    method: "POST",
    url: `/api/v1/class-meetings/${id}/${action}`,
    headers: p[as].headers,
  });

beforeAll(async () => {
  world = new MeetWorld();
  t = await createTestApp({ liveProvider: new FakeLiveProvider(world), phoneDialIn: true });
  t.clock.set("2026-11-03T06:00:00Z");
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  await q("INSERT INTO provider_host_accounts (email) VALUES ($1), ($2)", [HOST_1, HOST_2]);
});

afterAll(async () => {
  await t.close();
});

describe("provisioning (INV-8: never in the request path)", () => {
  let m: ClassMeeting;

  beforeAll(async () => {
    await at("2026-11-03T06:00:00Z");
    world.calls.length = 0;
    m = await meeting("2026-11-05T09:00:00Z", "2026-11-05T11:00:00Z");
  });

  it("creates the meeting PENDING, with a provision job for 24 hours before, and calls nobody", async () => {
    expect(world.calls).toEqual([]);
    expect(m.providerStatus).toBe("PENDING");
    expect(m.hasOnlineLink).toBe(false);
    const jobs = await provisionJobs(m.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.start_after.toISOString()).toBe("2026-11-04T09:00:00.000Z");
    const snapshot = (
      await q<{ s: { googleMeet?: { config: { matching: unknown } } } }>(
        "SELECT policy_snapshot AS s FROM class_meetings WHERE id = $1",
        [m.id],
      )
    ).rows[0]?.s;
    expect(snapshot?.googleMeet?.config.matching).toEqual({
      googleId: false,
      memberEmail: false,
      nameAssisted: true,
    });
  });

  it("creates the space in the worker, READY, on a host account, with the course's people as members", async () => {
    await runJobs();
    const r = await row(m.id);
    expect(r).toMatchObject({
      provider: "google_meet",
      provider_status: "READY",
      host_email: HOST_1,
    });
    expect(r?.join_url).toMatch(/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    expect(r?.access_synced_at).not.toBeNull();
    const space = world.space(r?.provider_space_id ?? "");
    expect(space?.settings).toEqual({
      accessType: "RESTRICTED",
      moderation: true,
      presentRestriction: "HOSTS_ONLY",
      autoRecording: true,
    });
    // The student has no linked Google account yet: reported, not a member (must knock).
    expect(Object.fromEntries(space?.members ?? [])).toEqual({
      [p.l1Primary.email.toLowerCase()]: "COHOST",
      [p.l2Co.email.toLowerCase()]: "COHOST",
      [p.l3Assistant.email.toLowerCase()]: "COHOST",
    });
    const audit = (
      await q<{ metadata: Record<string, unknown> }>(
        "SELECT metadata FROM audit_logs WHERE action = 'meeting.class-meeting.access-synced' AND resource_id = $1",
        [m.id],
      )
    ).rows[0];
    expect(audit?.metadata).toMatchObject({ STUDENT_NO_GOOGLE_ACCOUNT: 1, members: 0 });
    // Managers see the provisioned link; the event and audit row were written.
    const view = await t.request({
      url: `/api/v1/class-meetings/${m.id}`,
      headers: p.l1Primary.headers,
    });
    expect(view.json<ClassMeeting>()).toMatchObject({
      providerStatus: "READY",
      joinUrl: r?.join_url,
    });
  });

  it("adds a student once they link Google, when the course's people change", async () => {
    await q(
      "INSERT INTO identities (user_id, provider, subject, email, metadata) VALUES ($1, 'google', '111', $2, '{}')",
      [p.sEnrolled.userId, STUDENT_GMAIL],
    );
    expect(await provisioning().queueSyncForOffering(p.world.offerings.O1)).toBe(1);
    await runJobs();
    const space = world.space((await row(m.id))?.provider_space_id ?? "");
    expect(space?.members.get(STUDENT_GMAIL)).toBe("MEMBER");
  });

  it("spreads overlapping meetings across host accounts", async () => {
    const a = await meeting("2026-11-06T09:00:00Z", "2026-11-06T10:00:00Z");
    const b = await meeting("2026-11-06T09:30:00Z", "2026-11-06T10:30:00Z", { offering: "O2" });
    const c = await meeting("2026-11-07T09:00:00Z", "2026-11-07T10:00:00Z");
    await runJobs();
    const hosts = [(await row(a.id))?.host_email, (await row(b.id))?.host_email];
    expect(new Set(hosts)).toEqual(new Set([HOST_1, HOST_2]));
    expect((await row(c.id))?.host_email).toBe(HOST_1);
  });

  it("asks again for a pending space when a reschedule moves the class earlier", async () => {
    const later = await meeting("2026-11-20T09:00:00Z", "2026-11-20T10:00:00Z");
    const moved = await t.request({
      method: "PATCH",
      url: `/api/v1/class-meetings/${later.id}`,
      headers: { ...p.acadAdmin.headers, "if-match": `"${String(later.version)}"` },
      payload: { scheduledStart: "2026-11-10T09:00:00Z", scheduledEnd: "2026-11-10T10:00:00Z" },
    });
    expect(moved.statusCode).toBe(200);
    const starts = (await provisionJobs(later.id)).map((j) => j.start_after.toISOString());
    expect(starts).toContain("2026-11-09T09:00:00.000Z");
    await runJobs();
    expect((await row(later.id))?.provider_status).toBe("READY");
  });

  it("makes no Google call to cancel", async () => {
    const doomed = await meeting("2026-11-21T09:00:00Z", "2026-11-21T10:00:00Z");
    await runJobs();
    world.calls.length = 0;
    const cancelled = await t.request({
      method: "POST",
      url: `/api/v1/class-meetings/${doomed.id}/cancel`,
      headers: p.acadAdmin.headers,
      payload: { reason: "Public holiday" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(world.calls).toEqual([]);
  });
});

describe("joining a Google Meet class", () => {
  it("gives an enrolled student the provisioned link, with dial-in, logging the attempt", async () => {
    await at("2026-11-08T06:00:00Z");
    const m = await meeting("2026-11-08T09:00:00Z", "2026-11-08T10:00:00Z");
    await runJobs();
    await at("2026-11-08T08:50:00Z");
    const joined = await act("sEnrolled", m.id, "join");
    expect(joined.statusCode).toBe(200);
    expect(joined.json()).toMatchObject({
      onlineLink: (await row(m.id))?.join_url,
      linkSource: "PROVIDER",
      role: "STUDENT",
      dialIn: { numbers: [{ region: "NG", phone: "+234 1 000 0000", pin: "123456" }] },
    });
  });

  it("requires a linked Google account for students, but not for staff", async () => {
    await at("2026-11-09T06:00:00Z");
    const m = await meeting("2026-11-09T09:00:00Z", "2026-11-09T10:00:00Z");
    await runJobs();
    await q("DELETE FROM identities WHERE user_id = $1 AND provider = 'google'", [
      p.sEnrolled.userId,
    ]);
    await at("2026-11-09T08:50:00Z");
    const refused = await act("sEnrolled", m.id, "join");
    expect(refused.statusCode).toBe(422);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe("GOOGLE_ACCOUNT_REQUIRED");
    expect((await act("l1Primary", m.id, "join")).statusCode).toBe(200);
    const log = await q<{ outcome: string; deny_reason: string | null }>(
      "SELECT outcome, deny_reason FROM meeting_join_log WHERE class_meeting_id = $1 AND user_id = $2",
      [m.id, p.sEnrolled.userId],
    );
    expect(log.rows).toEqual([{ outcome: "DENIED", deny_reason: "GOOGLE_ACCOUNT_REQUIRED" }]);
    await q(
      "INSERT INTO identities (user_id, provider, subject, email, metadata) VALUES ($1, 'google', '111', $2, '{}')",
      [p.sEnrolled.userId, STUDENT_GMAIL],
    );
  });

  it("says the link is being prepared (Retry-After), and asks for it at once close to the start", async () => {
    await at("2026-11-10T06:00:00Z");
    const m = await meeting("2026-11-10T12:00:00Z", "2026-11-10T13:00:00Z");
    await at("2026-11-10T11:50:00Z");
    const waiting = await act("sEnrolled", m.id, "join");
    expect(waiting.statusCode).toBe(503);
    expect(waiting.headers["retry-after"]).toBe("30");
    expect(waiting.json<{ error: { code: string } }>().error.code).toBe("PROVIDER_NOT_READY");
    const jobs = await provisionJobs(m.id);
    expect(jobs).toHaveLength(2);
    expect(jobs[1]?.priority).toBe(10);
  });

  it("falls back to a link a Lecturer pasted while the space isn't ready", async () => {
    await at("2026-11-11T06:00:00Z");
    const m = await meeting("2026-11-11T09:00:00Z", "2026-11-11T10:00:00Z", {
      onlineLink: "https://meet.google.com/abc-defg-hij",
    });
    await at("2026-11-11T08:50:00Z");
    const joined = await act("sEnrolled", m.id, "join");
    expect(joined.statusCode).toBe(200);
    expect(joined.json()).toMatchObject({
      onlineLink: "https://meet.google.com/abc-defg-hij",
      linkSource: "PASTED",
      dialIn: null,
    });
  });

  it("never gives the link to people who aren't on the course (AC-04)", async () => {
    await at("2026-11-12T06:00:00Z");
    const m = await meeting("2026-11-12T09:00:00Z", "2026-11-12T10:00:00Z");
    await runJobs();
    await at("2026-11-12T08:55:00Z");
    for (const who of ["sOther", "sCompleted", "l4Other", "noRole", "applicant"] as const) {
      const res = await act(who, m.id, "join");
      expect(res.statusCode, who).toBe(404);
      expect(res.body, who).not.toContain("meet.google.com");
    }
  });
});

describe("failures and reprovision (§11.6, §11.10)", () => {
  beforeEach(async () => {
    await at("2026-11-13T07:30:00Z");
  });

  it("marks a refused space ERROR, tells the System Admin and (close to class) the Lecturers", async () => {
    const m = await meeting("2026-11-13T09:00:00Z", "2026-11-13T10:00:00Z");
    world.failNext("provisionSpace", "permanent");
    await runJobs();
    expect(await row(m.id)).toMatchObject({ provider_status: "ERROR" });
    expect((await row(m.id))?.provision_error).toContain("forbidden");
    const notified = (
      await q<{ user_id: string }>(
        "SELECT user_id FROM notifications WHERE kind = 'meeting.provision-failed' AND data->>'meetingId' = $1",
        [m.id],
      )
    ).rows.map((r) => r.user_id);
    expect(new Set(notified)).toEqual(
      new Set([p.sysAdmin.userId, p.l1Primary.userId, p.l2Co.userId, p.l3Assistant.userId]),
    );
    const failures = await t.request({
      url: "/api/v1/admin/ops/failures",
      headers: p.sysAdmin.headers,
    });
    expect(failures.body).toContain(m.id);

    // Students and other courses' Lecturers can't ask again.
    expect((await act("sEnrolled", m.id, "reprovision")).statusCode).toBe(404);
    expect((await act("l4Other", m.id, "reprovision")).statusCode).toBe(404);
    const again = await act("l1Primary", m.id, "reprovision");
    expect(again.statusCode).toBe(202);
    expect(again.json<ClassMeeting>()).toMatchObject({
      providerStatus: "PENDING",
      provisionError: null,
    });
    await runJobs();
    expect((await row(m.id))?.provider_status).toBe("READY");
    expect((await act("l1Primary", m.id, "reprovision")).statusCode).toBe(409);
  });

  it("retries a Google outage, then gives up as ERROR on the last attempt", async () => {
    const m = await meeting("2026-11-14T09:00:00Z", "2026-11-14T10:00:00Z");
    world.failNext("provisionSpace", "unavailable", 7);
    await runJobs();
    expect((await row(m.id))?.provider_status).toBe("ERROR");
    expect(world.calls.filter((c) => c === "provisionSpace").length).toBeGreaterThanOrEqual(7);
  });

  it("fails without an active host account", async () => {
    await q("UPDATE provider_host_accounts SET status = 'DISABLED'");
    const m = await meeting("2026-11-15T09:00:00Z", "2026-11-15T10:00:00Z");
    await runJobs();
    expect(await row(m.id)).toMatchObject({ provider_status: "ERROR", host_email: null });
    expect((await row(m.id))?.provision_error).toContain("no active Google host account");
    await q("UPDATE provider_host_accounts SET status = 'ACTIVE'");
  });
});

describe("start and end", () => {
  it("syncs members at start, and ending the class ends the call in Meet", async () => {
    await at("2026-11-16T06:00:00Z");
    const m = await meeting("2026-11-16T09:00:00Z", "2026-11-16T10:00:00Z");
    await runJobs();
    const spaceId = (await row(m.id))?.provider_space_id ?? "";
    await at("2026-11-16T08:55:00Z");
    const started = await act("l1Primary", m.id, "start");
    expect(started.statusCode).toBe(200);
    expect(started.json<{ onlineLink: string }>().onlineLink).toBe((await row(m.id))?.join_url);
    world.calls.length = 0;
    await runJobs();
    expect(world.calls).toContain("syncAccess");

    world.startConference(spaceId);
    expect(world.space(spaceId)?.activeConferenceId).not.toBeNull();
    await at("2026-11-16T10:00:00Z");
    expect((await act("l1Primary", m.id, "end")).statusCode).toBe(200);
    await runJobs();
    expect(world.space(spaceId)?.activeConferenceId).toBeNull();
  });
});
