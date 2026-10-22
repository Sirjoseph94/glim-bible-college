import type { GoogleIntegration, HostAccount, OpsFailure, QueueName } from "@glim/contracts";
import { drainQueues } from "@glim/db/testing";
import { DWD_SCOPES } from "@glim/integrations/google/auth";
import { FakeLiveProvider } from "@glim/integrations/live-provider/fake";
import { MeetWorld } from "@glim/integrations/live-provider/world";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { ClassMeetingsService } from "@glim/modules/class-meeting";
import { unwrap } from "@glim/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandlers } from "../../worker/src/handlers";
import { createSubscribers } from "../../worker/src/subscribers";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type Personas } from "./personas";

/**
 * The System Admin's integrations (TRD §15.3, Appendix A): Google Meet's setup values, host
 * accounts, the background test and storage watch; the YouTube channel connection; and the ops
 * page's view of the integration's failures.
 */

let t: TestApp;
let p: Personas;
let world: MeetWorld;
let handlers: ReturnType<typeof createHandlers>;

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

const run = () =>
  drainQueues(
    t.boss,
    Object.fromEntries(
      (Object.keys(handlers) as QueueName[])
        .filter((queue) => !queue.startsWith("db.") && queue !== "ops.queue-health")
        .map((queue) => [queue, handlers[queue]]),
    ),
    { ignoreStartAfter: true, maxRounds: 200 },
  );

const admin = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
  t.request({
    method,
    url: `/api/v1${url}`,
    headers: p.sysAdmin.headers,
    ...(payload === undefined ? {} : { payload }),
  });

beforeAll(async () => {
  world = new MeetWorld(() => t.clock.now());
  t = await createTestApp({
    liveProvider: new FakeLiveProvider(world),
    tokenEncryptionKey: Buffer.alloc(32, 5),
  });
  t.clock.set("2026-11-02T06:00:00Z");
  p = await createPersonas(t);
  handlers = createHandlers({ context: t.app, subscribers: createSubscribers(t.app) });
});

afterAll(async () => {
  await t.close();
});

describe("Google Meet setup (Appendix A.2, §15.3)", () => {
  let host: HostAccount;

  it("shows what to paste into the Admin Console, only to the System Admin", async () => {
    const view = await admin("GET", "/admin/integrations/google");
    expect(view.statusCode).toBe(200);
    expect(view.json<GoogleIntegration>()).toMatchObject({
      mode: "fake",
      status: null,
      delegationScopes: [...DWD_SCOPES],
      hostAccounts: [],
      lastCheck: null,
    });
    const academic = await t.request({
      url: "/api/v1/admin/integrations/google",
      headers: p.acadAdmin.headers,
    });
    expect(academic.statusCode).toBe(403);
  });

  it("keeps host accounts on the Workspace domain, once each", async () => {
    expect(
      (
        await admin("POST", "/admin/integrations/google", { primaryDomain: "GLIM.test" })
      ).json<GoogleIntegration>().primaryDomain,
    ).toBe("glim.test");
    const outsider = await admin("POST", "/admin/integrations/google/host-accounts", {
      email: "someone@gmail.com",
    });
    expect(outsider.statusCode).toBe(400);
    const added = await admin("POST", "/admin/integrations/google/host-accounts", {
      email: "LMS-Host-01@glim.test",
    });
    expect(added.statusCode).toBe(201);
    host = added.json<HostAccount>();
    expect(host).toMatchObject({
      email: "lms-host-01@glim.test",
      status: "ACTIVE",
      providerUserId: null,
      subscription: null,
      circuit: "CLOSED",
    });
    expect(
      (
        await admin("POST", "/admin/integrations/google/host-accounts", {
          email: "lms-host-01@glim.test",
        })
      ).statusCode,
    ).toBe(409);
  });

  it("tests Google in the background: first asking for the host's user id, then verified", async () => {
    expect((await admin("POST", "/admin/integrations/google/test")).statusCode).toBe(202);
    await run();
    let view = (await admin("GET", "/admin/integrations/google")).json<GoogleIntegration>();
    expect(view.status).toBe("DEGRADED");
    expect(view.lastCheck?.detail).toContain("Google user id of lms-host-01@glim.test");

    const updated = await admin("PATCH", `/admin/integrations/google/host-accounts/${host.id}`, {
      providerUserId: world.host("lms-host-01@glim.test").userId,
    });
    expect(updated.statusCode).toBe(200);
    await admin("POST", "/admin/integrations/google/test");
    await run();
    view = (await admin("GET", "/admin/integrations/google")).json<GoogleIntegration>();
    expect(view).toMatchObject({ status: "VERIFIED", lastError: null });
    expect(view.lastCheck).toMatchObject({
      ok: true,
      subscriptions: { created: 1, failed: 0, missingUserId: [] },
    });
    expect(view.lastCheck?.hosts[0]?.permissions.every((x) => x.granted)).toBe(true);
    expect(view.hostAccounts[0]?.subscription?.status).toBe("ACTIVE");
  });

  it("names a delegated scope the Admin Console is missing, and tells the System Admin", async () => {
    world.deniedPermissions.add(DWD_SCOPES[2]);
    await admin("POST", "/admin/integrations/google/test");
    await run();
    const view = (await admin("GET", "/admin/integrations/google")).json<GoogleIntegration>();
    expect(view.status).toBe("DEGRADED");
    expect(view.lastCheck?.detail).toContain(DWD_SCOPES[2]);
    const told = await q<{ c: number }>(
      "SELECT count(*)::int AS c FROM notifications WHERE kind = 'integration.google-degraded' AND user_id = $1",
      [p.sysAdmin.userId],
    );
    expect(told.rows[0]?.c).toBeGreaterThanOrEqual(1);
    world.deniedPermissions.clear();
  });

  it("warns when a host account's Drive is filling up", async () => {
    const h = world.host("lms-host-01@glim.test");
    h.usedBytes = Math.ceil((h.limitBytes ?? 0) * 0.9);
    await t.boss.send("drive.storage-monitor", {});
    await run();
    const told = await q<{ title: string }>(
      "SELECT title FROM notifications WHERE kind = 'integration.drive-storage'",
    );
    expect(told.rows[0]?.title).toContain("90% full");
    h.usedBytes = 0;
  });
});

describe("the YouTube channel connection (Appendix A.4 step 5)", () => {
  it("connects through Google's consent, checking the round trip's state", async () => {
    let status = (await admin("GET", "/admin/integrations/youtube/status")).json<{
      channel: { uploadsEnabled: boolean; connected: boolean };
    }>();
    expect(status.channel).toMatchObject({ uploadsEnabled: true, connected: false });

    const start = await admin("GET", "/admin/integrations/youtube/connect");
    expect(start.statusCode).toBe(302);
    const consent = new URL(start.headers.location as string);
    const state = consent.searchParams.get("state") ?? "";
    expect(consent.searchParams.get("redirect_uri")).toMatch(
      /\/api\/v1\/admin\/integrations\/youtube\/callback$/,
    );
    const cookie = (start.headers["set-cookie"] as string).split(";")[0] ?? "";

    const forged = await t.request({
      url: `/api/v1/admin/integrations/youtube/callback?code=good-code&state=other`,
      headers: { ...p.sysAdmin.headers, cookie: `${p.sysAdmin.headers.cookie ?? ""}; ${cookie}` },
    });
    expect(forged.headers.location).toBe("/admin/integrations?youtube=failed");

    const back = await t.request({
      url: `/api/v1/admin/integrations/youtube/callback?code=good-code&state=${state}`,
      headers: { ...p.sysAdmin.headers, cookie: `${p.sysAdmin.headers.cookie ?? ""}; ${cookie}` },
    });
    expect(back.headers.location).toBe("/admin/integrations?youtube=connected");
    status = (await admin("GET", "/admin/integrations/youtube/status")).json();
    expect(status.channel).toMatchObject({
      connected: true,
      status: "VERIFIED",
      channel: { id: "UCglimfakechannel000000" },
    });
    expect(JSON.stringify(status)).not.toContain(t.videoHost.channelApi.grant);
  });

  it("disconnects", async () => {
    const res = await admin("POST", "/admin/integrations/youtube/disconnect");
    expect(res.json()).toMatchObject({ connected: false, status: "DISABLED" });
  });
});

describe("the integration's failures on the ops page", () => {
  it("lists a Meet link Google refused (degrading the integration), and asks again on replay", async () => {
    t.clock.set("2026-11-05T06:00:00Z");
    p.sysAdmin.headers = await sessionFor(t, p.sysAdmin.userId);
    const meeting = unwrap(
      await t.app.get(ClassMeetingsService).create(
        p.world.offerings.O1,
        {
          title: "Refused",
          scheduledStart: "2026-11-05T09:00:00Z",
          scheduledEnd: "2026-11-05T10:00:00Z",
        },
        { ...SYSTEM_ACTOR, userId: p.acadAdmin.userId },
      ),
    ).meeting;
    world.failNext("provisionSpace", "permanent");
    await run();
    const listed = await admin("GET", "/admin/ops/failures");
    expect(listed.statusCode, listed.body).toBe(200);
    const failures = listed.json<{ items: OpsFailure[] }>();
    const item = failures.items.find((x) => x.kind === "meeting-provision" && x.id === meeting.id);
    expect(item).toMatchObject({ status: "ERROR", replayable: true });
    expect(item?.detail).toContain("forbidden");
    expect(
      (await admin("GET", "/admin/integrations/google")).json<GoogleIntegration>().status,
    ).toBe("DEGRADED");

    expect(
      (await admin("POST", `/admin/ops/replay/meeting-provision/${meeting.id}`)).statusCode,
    ).toBe(202);
    await run();
    const after = await q<{ s: string }>(
      "SELECT provider_status AS s FROM class_meetings WHERE id = $1",
      [meeting.id],
    );
    expect(after.rows[0]?.s).toBe("READY");
  });

  it("lists a subscription that isn't active", async () => {
    await q("UPDATE provider_subscriptions SET status = 'ERROR', last_error = 'Expired'");
    const failures = (await admin("GET", "/admin/ops/failures")).json<{ items: OpsFailure[] }>();
    expect(failures.items.find((x) => x.kind === "subscription")).toMatchObject({
      label: "lms-host-01@glim.test",
      detail: "Expired",
    });
    expect((await admin("POST", "/admin/ops/replay/subscription/any")).statusCode).toBe(202);
    await run();
    const s = await q<{ s: string }>("SELECT status AS s FROM provider_subscriptions");
    expect(s.rows[0]?.s).toBe("ACTIVE");
  });
});
