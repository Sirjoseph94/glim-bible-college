import type { Application, ReviewedApplication } from "@glim/contracts";
import { FakeOidcIssuer } from "@glim/integrations/oidc/fake-issuer";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
import { OffersService } from "@glim/modules/admissions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admissionsWorld } from "./admissions-world";
import { applicantKit } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type Personas } from "./personas";

let issuer: FakeOidcIssuer;
let t: TestApp;
let p: Personas;
let kit: ReturnType<typeof applicantKit>;
let application: Application;
/** When the offer was made; every step below is measured from it. */
let offeredAt: number;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

beforeAll(async () => {
  issuer = await new FakeOidcIssuer().start();
  t = await createTestApp({
    identityProvider: new OpenIdConnectProvider({
      issuer: issuer.issuerUrl,
      clientId: issuer.clientId,
      clientSecret: issuer.clientSecret,
      allowHttp: true,
    }),
  });
  p = await createPersonas(t);
  await admissionsWorld(t, p);
  kit = applicantKit(t, issuer);
  const ready = await kit.complete("Kemi");
  await kit.submit(ready.headers, ready.application.id);
  await kit.admit(ready.application.id, p.admOfficer.headers);
  application = ready.application;
  offeredAt = t.clock.now().getTime();
  await kit.sendQueuedEmails();
});

afterAll(async () => {
  await t.close();
  await issuer.stop();
});

/** Moves the clock to `ms` after the offer, runs the hourly sweep and sends what it queued. */
async function sweepAt(ms: number) {
  t.clock.set(new Date(offeredAt + ms));
  const result = await t.app.get(OffersService).sweep();
  await kit.sendQueuedEmails();
  return result;
}

const emailsToKemi = () =>
  t.mailer.sent.filter((m) => m.to === "kemi.mail@gmail.com").map((m) => m.subject);

async function status(): Promise<{
  status: string;
  purge_after: Date | null;
  offer_expires_at: Date;
}> {
  const { rows } = await t.db.pool.query<{
    status: string;
    purge_after: Date | null;
    offer_expires_at: Date;
  }>("SELECT status, purge_after, offer_expires_at FROM applications WHERE id = $1", [
    application.id,
  ]);
  const [row] = rows;
  if (row === undefined) throw new Error("application missing");
  return row;
}

describe("offer reminders", () => {
  it("are sent 7 days before expiry, once, not a minute earlier", async () => {
    expect(await sweepAt(14 * DAY - MINUTE)).toEqual({ lapsed: 0, reminded: 0 });
    expect(await sweepAt(14 * DAY)).toEqual({ lapsed: 0, reminded: 1 });
    expect(emailsToKemi().at(-1)).toBe(
      "Reminder: your offer from GLIM Online Bible College expires in 7 days",
    );
    expect(await sweepAt(14 * DAY + 60 * MINUTE)).toEqual({ lapsed: 0, reminded: 0 });
  });

  it("are sent again 2 days before expiry", async () => {
    expect(await sweepAt(19 * DAY - MINUTE)).toEqual({ lapsed: 0, reminded: 0 });
    expect(await sweepAt(19 * DAY)).toEqual({ lapsed: 0, reminded: 1 });
    expect(emailsToKemi().at(-1)).toBe(
      "Reminder: your offer from GLIM Online Bible College expires in 2 days",
    );
  });
});

describe("an offer nobody accepts", () => {
  it("is still open at the very moment it expires, and lapses just after", async () => {
    expect(await sweepAt(21 * DAY)).toEqual({ lapsed: 0, reminded: 0 });
    expect((await status()).status).toBe("ADMITTED");

    expect(await sweepAt(21 * DAY + MINUTE)).toEqual({ lapsed: 1, reminded: 0 });
    const row = await status();
    expect(row.status).toBe("LAPSED");
    const purge = row.purge_after ?? new Date(0);
    expect(purge.getUTCFullYear() * 12 + purge.getUTCMonth()).toBe(
      new Date(offeredAt + 21 * DAY + MINUTE).getUTCFullYear() * 12 +
        new Date(offeredAt + 21 * DAY + MINUTE).getUTCMonth() +
        12,
    );
    expect(emailsToKemi().at(-1)).toBe("Your offer from GLIM Online Bible College has lapsed");
    expect(await sweepAt(21 * DAY + 61 * MINUTE)).toEqual({ lapsed: 0, reminded: 0 });
  });
});

describe("reopening a lapsed offer", () => {
  it("needs a reason, sets a new deadline, clears the purge date, and is audited", async () => {
    t.clock.set(new Date(offeredAt + 25 * DAY));
    const officer = await sessionFor(t, p.admOfficer.userId);
    const url = `/api/v1/admissions/applications/${application.id}/reopen-offer`;
    const noReason = await t.request({ method: "POST", url, headers: officer, payload: {} });
    expect(noReason.statusCode).toBe(400);

    const res = await t.request({
      method: "POST",
      url,
      headers: officer,
      payload: { reason: "Was in hospital when the offer came" },
    });
    expect(res.statusCode).toBe(200);
    const reopened = res.json<ReviewedApplication>();
    expect(reopened.status).toBe("ADMITTED");
    expect(reopened.decision.offerExpiresAt).toBe(
      new Date(offeredAt + 25 * DAY + 21 * DAY).toISOString(),
    );
    expect(reopened.notes.map((n) => n.note)).toContain(
      "Offer reopened: Was in hospital when the offer came",
    );
    expect((await status()).purge_after).toBeNull();

    const audit = await t.request({
      url: `/api/v1/audit-logs?resourceType=application&resourceId=${application.id}`,
      headers: await sessionFor(t, p.sysAdmin.userId),
    });
    expect(
      audit
        .json<{ items: { action: string; metadata: Record<string, unknown> }[] }>()
        .items.find((i) => i.action === "admissions.application.offer-reopened")?.metadata,
    ).toMatchObject({ reason: "Was in hospital when the offer came" });

    await kit.sendQueuedEmails();
    expect(emailsToKemi().at(-1)).toBe("Your offer of a place at GLIM Online Bible College");

    const again = await t.request({
      method: "POST",
      url,
      headers: officer,
      payload: { reason: "Twice" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("gets its own reminders before the new deadline", async () => {
    expect(await sweepAt(25 * DAY + 14 * DAY)).toEqual({ lapsed: 0, reminded: 1 });
    expect(emailsToKemi().at(-1)).toBe(
      "Reminder: your offer from GLIM Online Bible College expires in 7 days",
    );
  });
});
