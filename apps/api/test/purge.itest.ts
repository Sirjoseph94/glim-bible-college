import type { Application } from "@glim/contracts";
import { FakeOidcIssuer } from "@glim/integrations/oidc/fake-issuer";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
import { OBJECT_STORAGE, type ObjectStorage } from "@glim/integrations/storage/port";
import { PurgeService } from "@glim/modules/admissions";
import { CONFIG, type Config } from "@glim/shared/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admissionsWorld } from "./admissions-world";
import { applicantKit, idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type Personas } from "./personas";

let issuer: FakeOidcIssuer;
let t: TestApp;
let p: Personas;
let kit: ReturnType<typeof applicantKit>;
const apps: Record<string, { headers: Record<string, string>; application: Application }> = {};

const DAY = 24 * 60 * 60 * 1000;

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
  const officer = p.admOfficer.headers;
  const decide = async (id: string, decision: "ADMIT" | "REJECT") => {
    await t.request({
      method: "POST",
      url: `/api/v1/admissions/applications/${id}/review`,
      headers: officer,
    });
    await t.request({
      method: "POST",
      url: `/api/v1/admissions/applications/${id}/decide`,
      headers: { ...officer, "idempotency-key": idempotencyKey() },
      payload: { decision },
    });
  };

  // Rejected, withdrawn, accepted and still-submitted applications, and a draft left alone.
  for (const name of ["Rejected", "Withdrawn", "Accepted", "Waiting"]) {
    const ready = await kit.complete(name);
    await kit.submit(ready.headers, ready.application.id);
    apps[name] = ready;
  }
  await decide(apps.Rejected?.application.id ?? "", "REJECT");
  await t.request({
    method: "POST",
    url: `/api/v1/applications/${apps.Withdrawn?.application.id ?? ""}/withdraw`,
    headers: apps.Withdrawn?.headers ?? {},
  });
  await decide(apps.Accepted?.application.id ?? "", "ADMIT");
  await t.request({
    method: "POST",
    url: `/api/v1/applications/${apps.Accepted?.application.id ?? ""}/accept`,
    headers: { ...(apps.Accepted?.headers ?? {}), "idempotency-key": idempotencyKey() },
  });
  const stale = await kit.signUp({ sub: "google-stale", email: "stale@gmail.com" });
  apps.StaleDraft = { headers: stale, application: (await kit.start(stale)).json<Application>() };
  await kit.sendQueuedEmails();
});

afterAll(async () => {
  await t.close();
  await issuer.stop();
});

const exists = async (id: string) =>
  (await t.db.pool.query("SELECT 1 FROM applications WHERE id = $1", [id])).rowCount === 1;
const idOf = (name: string) => apps[name]?.application.id ?? "";

describe("the daily purge", () => {
  it("keeps everything until its time comes", async () => {
    const start = t.clock.now();
    t.clock.set(new Date(start.getTime() + 300 * DAY));
    expect(await t.app.get(PurgeService).run()).toEqual({ purged: 0, deactivated: 0 });
    t.clock.set(start);
  });

  it("deletes ended applications and stale drafts after 12 months, with their events, notifications and photo", async () => {
    const { rows: photos } = await t.db.pool.query<{ id: string; storage_key: string }>(
      "SELECT f.id, f.storage_key FROM files f JOIN applications a ON a.photo_file_id = f.id WHERE a.id = $1",
      [idOf("Rejected")],
    );
    const photo = photos[0];
    expect(photo).toBeDefined();

    t.clock.set(new Date(t.clock.now().getTime() + 366 * DAY));
    expect(await t.app.get(PurgeService).run()).toEqual({ purged: 3, deactivated: 3 });

    for (const name of ["Rejected", "Withdrawn", "StaleDraft"])
      expect(await exists(idOf(name))).toBe(false);
    for (const name of ["Accepted", "Waiting"]) expect(await exists(idOf(name))).toBe(true);

    const leftovers = await t.db.pool.query(
      `SELECT 1 FROM application_events WHERE application_id::text = ANY($1)
       UNION ALL SELECT 1 FROM notifications WHERE data->>'applicationId' = ANY($1)
       UNION ALL SELECT 1 FROM files WHERE id = $2`,
      [[idOf("Rejected"), idOf("Withdrawn"), idOf("StaleDraft")], photo?.id],
    );
    expect(leftovers.rowCount).toBe(0);
    const storage = t.app.get<ObjectStorage>(OBJECT_STORAGE);
    const bucket = t.app.get<Config>(CONFIG).storage.bucket;
    expect(await storage.head({ bucket, key: photo?.storage_key ?? "" })).toBeNull();
  });

  it("keeps only the reference number and final status in the audit log", async () => {
    const audit = await t.request({
      url: `/api/v1/audit-logs?resourceType=application&resourceId=${idOf("Rejected")}`,
      headers: await sessionFor(t, p.sysAdmin.userId),
    });
    const purged = audit
      .json<{ items: { action: string; metadata: Record<string, unknown> }[] }>()
      .items.find((i) => i.action === "admissions.application.purged");
    expect(Object.keys(purged?.metadata ?? {}).sort()).toEqual(["finalStatus", "referenceNo"]);
    expect(purged?.metadata.finalStatus).toBe("REJECTED");
    expect(purged?.metadata.referenceNo).toMatch(/^GLIM-APP-2027-/);
  });

  it("deactivates applicants left with nothing, but not students or those still applying", async () => {
    const { rows } = await t.db.pool.query<{ email: string; status: string }>(
      "SELECT email, status FROM users WHERE email IN ('rejected@gmail.com','withdrawn@gmail.com','stale@gmail.com','accepted@gmail.com','waiting@gmail.com') ORDER BY email",
    );
    expect(Object.fromEntries(rows.map((r) => [r.email, r.status]))).toEqual({
      "accepted@gmail.com": "ACTIVE",
      "rejected@gmail.com": "DEACTIVATED",
      "stale@gmail.com": "DEACTIVATED",
      "waiting@gmail.com": "ACTIVE",
      "withdrawn@gmail.com": "DEACTIVATED",
    });
    expect(await t.app.get(PurgeService).run()).toEqual({ purged: 0, deactivated: 0 });
  });
});
