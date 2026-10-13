import type { ClassMeeting } from "@glim/contracts";
import { drainQueues } from "@glim/db/testing";
import { FakeLiveProvider } from "@glim/integrations/live-provider/fake";
import { MeetWorld } from "@glim/integrations/live-provider/world";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import {
  ClassMeetingsService,
  MeetEventsService,
  ProvisioningService,
  SubscriptionsService,
} from "@glim/modules/class-meeting";
import { InboxService } from "@glim/modules/ops";
import { unwrap } from "@glim/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type Personas } from "./personas";

/**
 * Meet events, the inbox and reconciliation (TRD §11.8, INV-6), and Workspace Events
 * subscriptions, against the in-memory Meet. Events are hints: whatever order they come in,
 * duplicated or lost, the meeting ends up in the state Meet's own records say.
 */

let t: TestApp;
let p: Personas;
let world: MeetWorld;
let provider: FakeLiveProvider;
const HOST = "lms-host-01@glim.test";

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

const jobs = () =>
  drainQueues(
    t.boss,
    {
      "class-meeting.provision": (job) =>
        t.app
          .get(ProvisioningService)
          .provision((job.data as { meetingId: string }).meetingId, { final: true }),
      "provider-event.process": (job) =>
        t.app.get(InboxService).process((job.data as { providerEventId: string }).providerEventId),
    },
    { ignoreStartAfter: true },
  );

/** What the worker's puller does: store each pulled message, then acknowledge it. */
async function pull(): Promise<number> {
  const pulled = await provider.pullEvents(100);
  const stored = await t.app.get(InboxService).receive(
    "google_meet",
    pulled.map((x) => t.app.get(MeetEventsService).toInbox(x.envelope)),
  );
  await provider.ackEvents(pulled.map((x) => x.ackId));
  return stored;
}

async function provisioned(start: string, end: string): Promise<{ id: string; spaceId: string }> {
  const meeting: ClassMeeting = unwrap(
    await t.app
      .get(ClassMeetingsService)
      .create(
        p.world.offerings.O1,
        { title: `Class ${start}`, scheduledStart: start, scheduledEnd: end },
        { ...SYSTEM_ACTOR, userId: p.acadAdmin.userId },
      ),
  ).meeting;
  await jobs();
  const row = (
    await q<{ provider_space_id: string }>(
      "SELECT provider_space_id FROM class_meetings WHERE id = $1",
      [meeting.id],
    )
  ).rows[0];
  world.dropPending();
  return { id: meeting.id, spaceId: row?.provider_space_id ?? "" };
}

const meetingRow = async (id: string) =>
  (
    await q<{
      state: string;
      first_conference_started_at: Date | null;
      last_conference_ended_at: Date | null;
    }>(
      "SELECT state, first_conference_started_at, last_conference_ended_at FROM class_meetings WHERE id = $1",
      [id],
    )
  ).rows[0];

const conferences = async (id: string) =>
  (
    await q<{ status: string; dirty: boolean; ended_at: Date | null }>(
      "SELECT status, dirty, ended_at FROM conference_records WHERE class_meeting_id = $1 ORDER BY started_at",
      [id],
    )
  ).rows;

const queued = async (name: string) =>
  (
    await q<{ data: Record<string, unknown> }>(
      "SELECT data FROM pgboss.job WHERE name = $1 AND state = 'created' ORDER BY created_on",
      [name],
    )
  ).rows.map((r) => r.data);

beforeAll(async () => {
  world = new MeetWorld(() => t.clock.now());
  provider = new FakeLiveProvider(world);
  t = await createTestApp({ liveProvider: provider });
  t.clock.set("2026-11-03T06:00:00Z");
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  await q("INSERT INTO provider_host_accounts (email, provider_user_id) VALUES ($1, $2)", [
    HOST,
    world.host(HOST).userId,
  ]);
});

afterAll(async () => {
  await t.close();
});

describe("events drive the class (§11.8)", () => {
  it("goes LIVE when the call starts, ENDED when it ends, queuing attendance syncs", async () => {
    const m = await provisioned("2026-11-03T09:00:00Z", "2026-11-03T10:00:00Z");
    t.clock.set("2026-11-03T09:02:00Z");
    const conferenceId = world.startConference(m.spaceId, new Date("2026-11-03T09:01:00Z"));
    expect(await pull()).toBe(1);
    await jobs();
    expect(await meetingRow(m.id)).toMatchObject({
      state: "LIVE",
      first_conference_started_at: new Date("2026-11-03T09:01:00Z"),
    });
    expect(await conferences(m.id)).toEqual([{ status: "ACTIVE", dirty: true, ended_at: null }]);

    world.addSession(conferenceId, { startedAt: new Date("2026-11-03T09:03:00Z") });
    world.endConference(conferenceId, new Date("2026-11-03T10:01:00Z"));
    expect(await pull()).toBe(2);
    await jobs();
    expect(await meetingRow(m.id)).toMatchObject({
      state: "ENDED",
      last_conference_ended_at: new Date("2026-11-03T10:01:00Z"),
    });
    const syncs = (await queued("conference.sync")).filter(
      (d) => d.conferenceRecordId !== undefined,
    );
    expect(syncs.length).toBeGreaterThanOrEqual(2);
    const statuses = await q<{ status: string; event_type: string }>(
      "SELECT status, event_type FROM provider_events WHERE provider = 'google_meet' ORDER BY received_at",
    );
    expect(statuses.rows.map((r) => r.status)).toEqual(["PROCESSED", "PROCESSED", "PROCESSED"]);
  });

  it("ignores a duplicate delivery", async () => {
    const m = await provisioned("2026-11-04T09:00:00Z", "2026-11-04T10:00:00Z");
    world.startConference(m.spaceId, new Date("2026-11-04T09:00:00Z"));
    const pulled = await provider.pullEvents(10);
    const inbox = t.app.get(InboxService);
    const events = pulled.map((x) => t.app.get(MeetEventsService).toInbox(x.envelope));
    expect(await inbox.receive("google_meet", events)).toBe(1);
    expect(await inbox.receive("google_meet", events)).toBe(0);
    await provider.ackEvents(pulled.map((x) => x.ackId));
    await jobs();
    expect((await meetingRow(m.id))?.state).toBe("LIVE");
  });

  it("ends up ENDED when the end arrives before the start", async () => {
    const m = await provisioned("2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z");
    const conferenceId = world.startConference(m.spaceId, new Date("2026-11-05T09:00:00Z"));
    world.endConference(conferenceId, new Date("2026-11-05T10:00:00Z"));
    const pulled = await provider.pullEvents(10);
    const [started, ended] = pulled;
    if (started === undefined || ended === undefined) throw new Error("expected two events");
    const inbox = t.app.get(InboxService);
    const meet = t.app.get(MeetEventsService);
    await inbox.receive("google_meet", [meet.toInbox(ended.envelope)]);
    await jobs();
    await inbox.receive("google_meet", [meet.toInbox(started.envelope)]);
    await jobs();
    expect((await meetingRow(m.id))?.state).toBe("ENDED");
  });

  it("marks a conference for a sync on participant events, and queues discovery of a recording", async () => {
    const m = await provisioned("2026-11-06T09:00:00Z", "2026-11-06T10:00:00Z");
    const conferenceId = world.startConference(m.spaceId, new Date("2026-11-06T09:00:00Z"));
    await pull();
    await jobs();
    await q("UPDATE conference_records SET dirty = false WHERE class_meeting_id = $1", [m.id]);
    world.addSession(conferenceId, { startedAt: new Date("2026-11-06T09:05:00Z") });
    await pull();
    await jobs();
    expect((await conferences(m.id))[0]?.dirty).toBe(true);
    world.endConference(conferenceId, new Date("2026-11-06T10:00:00Z"));
    const recording = world.addRecording(conferenceId, {
      bytes: Buffer.from("video"),
      durationMs: 3_600_000,
    });
    await pull();
    await jobs();
    expect(await queued("recording.discover")).toContainEqual({
      meetingId: m.id,
      conferenceId,
      recordingId: recording.recordingId,
    });
  });

  it("ignores events for spaces that aren't Class Meetings", async () => {
    const stray = world.createSpace(HOST, {
      accessType: "OPEN",
      moderation: false,
      presentRestriction: "ANYONE",
      autoRecording: false,
    });
    const conferenceId = world.startConference(stray.spaceId);
    await pull();
    await jobs();
    const stored = await q<{ status: string }>(
      "SELECT status FROM provider_events WHERE subject = $1",
      [conferenceId],
    );
    expect(stored.rows).toEqual([{ status: "IGNORED" }]);
  });
});

describe("reconciliation repairs lost events (INV-6)", () => {
  it("starts, ends and restarts a class from Meet's records alone", async () => {
    const m = await provisioned("2026-11-07T09:00:00Z", "2026-11-07T10:00:00Z");
    const meet = t.app.get(MeetEventsService);
    t.clock.set("2026-11-07T09:05:00Z");
    const first = world.startConference(m.spaceId, new Date("2026-11-07T09:01:00Z"));
    world.dropPending();
    expect(await meet.reconcile()).toMatchObject({ started: 1 });
    expect((await meetingRow(m.id))?.state).toBe("LIVE");
    // Running it again changes nothing.
    expect(await meet.reconcile()).toMatchObject({ started: 0, ended: 0 });

    t.clock.set("2026-11-07T10:05:00Z");
    world.endConference(first, new Date("2026-11-07T10:00:00Z"));
    world.dropPending();
    expect(await meet.reconcile()).toMatchObject({ ended: 1 });
    expect((await meetingRow(m.id))?.state).toBe("ENDED");

    // The Lecturer reconnects within the overrun: a new call makes it live again.
    world.startConference(m.spaceId, new Date("2026-11-07T10:06:00Z"));
    world.dropPending();
    t.clock.set("2026-11-07T10:07:00Z");
    expect(await meet.reconcile()).toMatchObject({ started: 1 });
    expect((await meetingRow(m.id))?.state).toBe("LIVE");
    expect(await conferences(m.id)).toHaveLength(2);
  });

  it("leaves a class the Lecturer started by hand alone when no call has happened", async () => {
    const m = await provisioned("2026-11-08T09:00:00Z", "2026-11-08T10:00:00Z");
    await q("UPDATE class_meetings SET state = 'LIVE' WHERE id = $1", [m.id]);
    t.clock.set("2026-11-08T09:10:00Z");
    expect(await t.app.get(MeetEventsService).reconcile()).toMatchObject({ ended: 0 });
    expect((await meetingRow(m.id))?.state).toBe("LIVE");
  });
});

describe("subscriptions (one per host account, §11.8)", () => {
  it("creates one, renews it when due, and recreates it when Google lost it", async () => {
    const subscriptions = t.app.get(SubscriptionsService);
    await q("INSERT INTO provider_host_accounts (email) VALUES ('lms-host-02@glim.test')");
    t.clock.set("2026-11-10T00:00:00Z");
    const first = await subscriptions.run();
    expect(first).toMatchObject({ created: 1, missingUserId: ["lms-host-02@glim.test"] });
    const sub = async () =>
      (
        await q<{ remote_name: string; status: string; expires_at: Date }>(
          "SELECT remote_name, status, expires_at FROM provider_subscriptions WHERE status <> 'ERROR'",
        )
      ).rows[0];
    const created = await sub();
    expect(created?.status).toBe("ACTIVE");
    expect(await subscriptions.run()).toMatchObject({ created: 0, renewed: 0 });

    // Within the renewal margin (max(24 h, half the lifetime)).
    const nearlyExpired = () =>
      q(
        "UPDATE provider_subscriptions SET expires_at = '2026-11-10T01:00:00Z', last_renewed_at = '2026-11-04T00:00:00Z'",
      );
    await nearlyExpired();
    expect(await subscriptions.run()).toMatchObject({ renewed: 1 });
    expect((await sub())?.expires_at.toISOString()).toBe("2026-11-17T00:00:00.000Z");

    world.subscriptions.clear();
    await nearlyExpired();
    expect(await subscriptions.run()).toMatchObject({ renewed: 1, failed: 0 });
    expect(world.subscriptions.size).toBe(1);
  });

  it("renews the subscription a lifecycle event names", async () => {
    const name = (
      await q<{ remote_name: string }>(
        "SELECT remote_name FROM provider_subscriptions WHERE status = 'ACTIVE'",
      )
    ).rows[0]?.remote_name;
    world.emit("SUBSCRIPTION_LIFECYCLE", HOST, new Date(), {
      subscription: name?.replace("subscriptions/", "") ?? "",
    });
    await pull();
    await jobs();
    expect(await queued("subscription.renew")).toContainEqual({ remoteName: name });
  });
});
