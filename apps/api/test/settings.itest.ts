import type { AuditLogItem, Me, PolicyView, Settings } from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, createUser, sessionFor, type Persona, type PersonaName } from "./personas";

let t: TestApp;
let p: Record<PersonaName, Persona>;

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
});

afterAll(async () => {
  await t.close();
});

const admin = () => p.sysAdmin.headers;

async function auditActions(resourceType: string): Promise<AuditLogItem[]> {
  const res = await t.request({
    url: `/api/v1/audit-logs?resourceType=${resourceType}`,
    headers: admin(),
  });
  return res.json<{ items: AuditLogItem[] }>().items;
}

describe("institution settings", () => {
  it("are edited under optimistic concurrency, normalised, audited, and reflected publicly", async () => {
    const before = (
      await t.request({ url: "/api/v1/settings", headers: admin() })
    ).json<Settings>();
    expect(before).toMatchObject({
      name: "GLIM Online Bible College",
      timezone: "Africa/Lagos",
      staffEmailDomains: [],
      version: 1,
    });

    const saved = await t.request({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: { ...admin(), "if-match": `"${String(before.version)}"` },
      payload: {
        name: "GLIM Bible College",
        staffEmailDomains: ["GLIM.edu.ng"],
        statementOfFaithUrl: "https://glim.edu.ng/statement-of-faith",
        youtubeChannelUrls: ["https://www.youtube.com/@GLIMBibleCollege/"],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      name: "GLIM Bible College",
      staffEmailDomains: ["glim.edu.ng"],
      youtubeChannelUrls: ["https://www.youtube.com/@GLIMBibleCollege"],
      version: 2,
    });
    expect((await t.request({ url: "/api/v1/public/institution" })).json()).toMatchObject({
      name: "GLIM Bible College",
    });

    const stale = await t.request({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: { ...admin(), "if-match": '"1"' },
      payload: { name: "Lost update" },
    });
    expect(stale.statusCode).toBe(412);

    const [entry] = await auditActions("settings");
    expect(entry).toMatchObject({
      action: "identity.settings.updated",
      actorUserId: p.sysAdmin.userId,
      metadata: { name: { from: "GLIM Online Bible College", to: "GLIM Bible College" } },
    });
  });

  it("refuse values that aren't what they claim to be", async () => {
    const current = (
      await t.request({ url: "/api/v1/settings", headers: admin() })
    ).json<Settings>();
    const res = await t.request({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: { ...admin(), "if-match": `"${String(current.version)}"` },
      payload: { timezone: "Mars/Olympus", youtubeChannelUrls: ["https://vimeo.com/glim"] },
    });
    expect(res.statusCode).toBe(400);
    expect(
      res
        .json<{ error: { fieldErrors: { path: string }[] } }>()
        .error.fieldErrors.map((f) => f.path)
        .sort(),
    ).toEqual(["body.timezone", "body.youtubeChannelUrls.0"]);
  });
});

describe("policies", () => {
  it("start at version 0 with the TRD defaults", async () => {
    const res = await t.request({ url: "/api/v1/policies/JOIN_WINDOW", headers: admin() });
    expect(res.json()).toEqual({
      type: "JOIN_WINDOW",
      version: 0,
      config: {
        studentOpensBeforeMinutes: 15,
        studentClosesAfterMinutes: 60,
        staffOpensBeforeMinutes: 60,
        maxOverrunMinutes: 180,
      },
      effectiveFrom: null,
      createdBy: null,
    });
    const all = (await t.request({ url: "/api/v1/policies", headers: admin() })).json<{
      items: PolicyView[];
    }>();
    expect(all.items.map((i) => i.type)).toEqual([
      "ATTENDANCE",
      "JOIN_WINDOW",
      "RECORDING",
      "NOTIFICATION",
      "ADMISSIONS",
      "GRADING_DEFAULTS",
    ]);
  });

  it("append a new version on every save, validated against the policy's schema", async () => {
    const first = await t.request({
      method: "PUT",
      url: "/api/v1/policies/ATTENDANCE",
      headers: { ...admin(), "if-match": '"0"' },
      payload: { config: { presentThresholdBp: 8000, lockAfterDays: 5 } },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      version: 1,
      config: {
        presentThresholdBp: 8000,
        lockAfterDays: 5,
        partialThresholdBp: 2500,
        basis: "ACTUAL_CAPPED",
      },
      createdBy: p.sysAdmin.userId,
    });

    const replay = await t.request({
      method: "PUT",
      url: "/api/v1/policies/ATTENDANCE",
      headers: { ...admin(), "if-match": '"0"' },
      payload: { config: { presentThresholdBp: 9000 } },
    });
    expect(replay.statusCode).toBe(412);

    const invalid = await t.request({
      method: "PUT",
      url: "/api/v1/policies/ATTENDANCE",
      headers: { ...admin(), "if-match": '"1"' },
      payload: { config: { presentThresholdBp: 20000, made_up: true } },
    });
    expect(invalid.statusCode).toBe(400);

    const second = await t.request({
      method: "PUT",
      url: "/api/v1/policies/ATTENDANCE",
      headers: { ...admin(), "if-match": '"1"' },
      payload: { config: { presentThresholdBp: 7000 } },
    });
    expect(second.json()).toMatchObject({
      version: 2,
      config: { presentThresholdBp: 7000, lockAfterDays: 7 },
    });
    expect((await auditActions("policy")).map((a) => a.metadata)).toEqual(
      expect.arrayContaining([{ version: 1 }, { version: 2 }]),
    );
  });

  it("are a 400 for a policy type that doesn't exist", async () => {
    expect(
      (await t.request({ url: "/api/v1/policies/NOT_A_POLICY", headers: admin() })).statusCode,
    ).toBe(400);
  });
});

describe("viewer timezone", () => {
  it("is unset until the browser reports one, and the user can change it", async () => {
    const user = await createUser(t, { email: "traveller@glim.test" });
    const headers = await sessionFor(t, user.id);
    const fresh = (await t.request({ url: "/api/v1/me", headers })).json<Me>();
    expect(fresh.user).toMatchObject({ timezone: "Africa/Lagos", timezoneSet: false });

    const london = await t.request({
      method: "PATCH",
      url: "/api/v1/me",
      headers,
      payload: { timezone: "Europe/London" },
    });
    expect(london.json<Me>().user).toMatchObject({ timezone: "Europe/London", timezoneSet: true });

    const bad = await t.request({
      method: "PATCH",
      url: "/api/v1/me",
      headers,
      payload: { timezone: "Nowhere/Land" },
    });
    expect(bad.statusCode).toBe(400);
  });
});
