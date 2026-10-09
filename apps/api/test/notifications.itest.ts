import { generateKeyPairSync, sign } from "node:crypto";
import type { Notification, NotificationPreference } from "@glim/contracts";
import { Db } from "@glim/db";
import { drainQueues } from "@glim/db/testing";
import { NotificationsService } from "@glim/modules/notifications";
import { InboxService } from "@glim/modules/ops";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type PersonaName, type Personas } from "./personas";

/**
 * The notification centre, digest, quiet hours and bounces (TRD §15.1). The clock starts at
 * 2026-11-02T09:00Z: 10:00 in Lagos, 04:00 in New York.
 */

let t: TestApp;
let p: Personas;
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

const send = (as: PersonaName, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  t.request({
    method,
    url: `/api/v1${url}`,
    headers: p[as].headers,
    ...(payload === undefined ? {} : { payload }),
  });

/** Records a notification the way the modules do, in a transaction. */
async function notify(
  as: PersonaName,
  kind: string,
  title: string,
  extra: { email?: boolean; data?: Record<string, unknown> } = {},
) {
  const service = t.app.get(NotificationsService);
  await t.app.get(Db).withTx((tx) =>
    service.notify(tx, {
      userId: p[as].userId,
      kind,
      title,
      data: extra.data ?? {},
      email: extra.email ?? false,
    }),
  );
}

const statusOf = async (title: string) =>
  (
    await q<{ email_status: string }>("SELECT email_status FROM notifications WHERE title = $1", [
      title,
    ])
  ).rows[0]?.email_status;

/** A SendGrid delivery, signed with the test key as SendGrid signs it. */
function webhook(events: unknown[], options: { at?: Date; badSignature?: boolean } = {}) {
  const body = JSON.stringify(events);
  const timestamp = String(Math.floor((options.at ?? t.clock.now()).getTime() / 1000));
  const signature = sign("sha256", Buffer.from(timestamp + body), keys.privateKey).toString(
    "base64",
  );
  return t.request({
    method: "POST",
    url: "/api/v1/integrations/sendgrid/events",
    headers: {
      "content-type": "application/json",
      "x-twilio-email-event-webhook-signature": options.badSignature === true ? "AAAA" : signature,
      "x-twilio-email-event-webhook-timestamp": timestamp,
    },
    payload: body,
  });
}

beforeAll(async () => {
  t = await createTestApp({ sendgridWebhookPublicKey: publicKey });
  p = await createPersonas(t);
});

afterAll(async () => {
  await t.close();
});

describe("what gets emailed", () => {
  it("emails critical kinds at once and keeps the rest for the digest", async () => {
    await notify("sEnrolled", "transcript.issued", "Critical one", {
      email: true,
      data: { serialNo: "GLIM/TR/2026/00001" },
    });
    expect(await statusOf("Critical one")).toBe("PENDING");
    await notify("sEnrolled", "content.announcement", "Routine one");
    expect(await statusOf("Routine one")).toBe("DIGEST");
    const jobs = await q("SELECT 1 FROM pgboss.job WHERE name = 'notify.send'");
    expect(jobs.rowCount).toBe(1);
  });

  it("writes times in the recipient's zone with Lagos alongside", async () => {
    await q("UPDATE users SET timezone = 'America/New_York' WHERE id = $1", [p.sOther.userId]);
    await notify("sOther", "meeting.cancelled", "Class off", {
      email: true,
      data: { courseCode: "PBIB101", title: "Week 3", scheduledStart: "2026-11-05T14:00:00Z" },
    });
    const service = t.app.get(NotificationsService);
    await drainQueues(t.boss, {
      "notify.send": (job) =>
        service.deliver((job.data as { notificationId: string }).notificationId),
    });
    const mail = t.mailer.lastTo(p.sOther.email);
    expect(mail?.text).toMatch(/09:00/);
    expect(mail?.text).toMatch(/15:00 Lagos/);
  });
});

describe("preferences", () => {
  it("lists every kind, lets people turn non-critical ones off, and keeps critical email on", async () => {
    const prefs = (await send("sEnrolled", "GET", "/me/notification-preferences")).json<{
      items: NotificationPreference[];
    }>().items;
    expect(prefs.find((x) => x.kind === "transcript.issued")).toMatchObject({
      critical: true,
      email: true,
      inApp: true,
    });
    const off = await send(
      "sEnrolled",
      "PUT",
      "/me/notification-preferences/content.announcement",
      {
        inApp: true,
        email: false,
      },
    );
    expect(off.json<NotificationPreference>()).toMatchObject({ email: false });
    await notify("sEnrolled", "content.announcement", "Not by email");
    expect(await statusOf("Not by email")).toBe("NOT_REQUESTED");

    const critical = await send(
      "sEnrolled",
      "PUT",
      "/me/notification-preferences/transcript.issued",
      {
        inApp: true,
        email: false,
      },
    );
    expect(critical.json<NotificationPreference>().email).toBe(true);
    expect(
      (
        await send("sEnrolled", "PUT", "/me/notification-preferences/no.such", {
          inApp: true,
          email: true,
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe("the notification centre", () => {
  it("lists newest first with an unread count, pages, and marks read", async () => {
    for (let i = 1; i <= 3; i++)
      await notify("sCompleted", "assessment.grade-released", `Grade ${String(i)}`);
    const first = (await send("sCompleted", "GET", "/me/notifications?limit=2")).json<{
      items: Notification[];
      unread: number;
      nextBefore: string | null;
    }>();
    expect(first.items.map((n) => n.title)).toEqual(["Grade 3", "Grade 2"]);
    expect(first.items[0]?.link).toBe("/courses");
    expect(first.unread).toBe(3);
    const second = (
      await send("sCompleted", "GET", `/me/notifications?limit=2&before=${first.nextBefore ?? ""}`)
    ).json<{ items: Notification[]; nextBefore: string | null }>();
    expect(second.items.map((n) => n.title)).toEqual(["Grade 1"]);
    expect(second.nextBefore).toBeNull();

    const id = first.items[0]?.id ?? "";
    expect((await send("sOther", "POST", `/me/notifications/${id}/read`)).statusCode).toBe(204);
    expect(
      (await send("sCompleted", "GET", "/me/notifications")).json<{ unread: number }>().unread,
    ).toBe(3);
    expect((await send("sCompleted", "POST", `/me/notifications/${id}/read`)).statusCode).toBe(204);
    expect(
      (await send("sCompleted", "GET", "/me/notifications")).json<{ unread: number }>().unread,
    ).toBe(2);
    expect((await send("sCompleted", "POST", "/me/notifications/read-all")).json()).toEqual({
      count: 2,
    });

    // A kind turned off in-app disappears from the list.
    await send("sCompleted", "PUT", "/me/notification-preferences/assessment.grade-released", {
      inApp: false,
      email: true,
    });
    expect(
      (await send("sCompleted", "GET", "/me/notifications")).json<{ items: Notification[] }>()
        .items,
    ).toEqual([]);
  });
});

describe("the daily digest", () => {
  it("sends one email of the unread updates, outside quiet hours", async () => {
    const service = t.app.get(NotificationsService);
    // sEnrolled is in Lagos (no zone set): 10:00 there now.
    await notify("sEnrolled", "content.announcement", "Read already");
    await q("UPDATE notifications SET read_at = now() WHERE title = 'Read already'");
    expect(await service.digest(p.sEnrolled.userId)).toBe(1);
    const mail = t.mailer.lastTo(p.sEnrolled.email);
    expect(mail?.subject).toBe("Your GLIM updates (1)");
    expect(mail?.text).toContain("• Routine one");
    expect(await statusOf("Routine one")).toBe("SENT");
    expect(await statusOf("Read already")).toBe("NOT_REQUESTED");
  });

  it("waits for each person's own 06:00 during their quiet hours", async () => {
    const service = t.app.get(NotificationsService);
    await notify("sOther", "content.announcement", "For New York");
    await notify("sGraduated", "content.announcement", "For Lagos");
    expect(await service.digest()).toBeGreaterThanOrEqual(2);
    const jobs = await q<{ user_id: string; start_after: Date; created_on: Date }>(
      "SELECT data->>'userId' AS user_id, start_after, created_on FROM pgboss.job WHERE name = 'notify.digest'",
    );
    const ny = jobs.rows.find((j) => j.user_id === p.sOther.userId);
    const lagos = jobs.rows.find((j) => j.user_id === p.sGraduated.userId);
    // 04:00 in New York: held until 06:00 there, two hours on.
    const delay = ((ny?.start_after.getTime() ?? 0) - (ny?.created_on.getTime() ?? 0)) / 1000;
    expect(delay).toBeGreaterThan(2 * 3600 - 120);
    expect(delay).toBeLessThan(2 * 3600 + 120);
    expect((lagos?.start_after.getTime() ?? 0) - (lagos?.created_on.getTime() ?? 0)).toBeLessThan(
      5000,
    );
    // A digest that runs during quiet hours anyway sends nothing.
    expect(await service.digest(p.sOther.userId)).toBe(0);
    expect(await statusOf("For New York")).toBe("DIGEST");
  });
});

describe("bounces (SendGrid Event Webhook)", () => {
  it("refuses deliveries that aren't signed, or are stale", async () => {
    const events = [{ email: "x@example.com", event: "bounce", sg_event_id: "bad-1" }];
    expect((await webhook(events, { badSignature: true })).statusCode).toBe(401);
    const stale = new Date(t.clock.now().getTime() - 3600_000);
    expect((await webhook(events, { at: stale })).statusCode).toBe(401);
    const stored = await q("SELECT 1 FROM provider_events");
    expect(stored.rowCount).toBe(0);
  });

  it("stores events, then suppresses addresses that bounce; repeats are ignored", async () => {
    await notify("sGraduated", "transcript.issued", "Will be suppressed", {
      email: true,
      data: { serialNo: "X" },
    });
    const events = [
      {
        email: p.sGraduated.email.toUpperCase(),
        event: "bounce",
        sg_event_id: "ev-1",
        reason: "550",
      },
      { email: p.sGraduated.email, event: "delivered", sg_event_id: "ev-2" },
    ];
    expect((await webhook(events)).statusCode).toBe(204);
    expect((await webhook(events)).statusCode).toBe(204);
    const stored = await q<{ event_type: string; status: string }>(
      "SELECT event_type, status FROM provider_events ORDER BY event_id",
    );
    expect(stored.rows).toEqual([
      { event_type: "bounce", status: "RECEIVED" },
      { event_type: "delivered", status: "RECEIVED" },
    ]);
    const inbox = t.app.get(InboxService);
    await drainQueues(t.boss, {
      "provider-event.process": (job) =>
        inbox.process((job.data as { providerEventId: string }).providerEventId),
    });
    const after = await q<{ event_type: string; status: string }>(
      "SELECT event_type, status FROM provider_events ORDER BY event_id",
    );
    expect(after.rows.map((r) => r.status)).toEqual(["PROCESSED", "IGNORED"]);
    const user = await q<{ email_status: string }>("SELECT email_status FROM users WHERE id = $1", [
      p.sGraduated.userId,
    ]);
    expect(user.rows[0]?.email_status).toBe("BOUNCED");
    expect(await statusOf("Will be suppressed")).toBe("SUPPRESSED");
    expect(await statusOf("For Lagos")).toBe("SUPPRESSED");
  });

  it("records a spam report as a complaint", async () => {
    await webhook([{ email: p.registrar.email, event: "spamreport", sg_event_id: "ev-3" }]);
    const inbox = t.app.get(InboxService);
    await drainQueues(t.boss, {
      "provider-event.process": (job) =>
        inbox.process((job.data as { providerEventId: string }).providerEventId),
    });
    const user = await q<{ email_status: string }>("SELECT email_status FROM users WHERE id = $1", [
      p.registrar.userId,
    ]);
    expect(user.rows[0]?.email_status).toBe("COMPLAINED");
  });
});
