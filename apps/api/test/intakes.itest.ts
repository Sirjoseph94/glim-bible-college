import type { CurrentIntake, Intake } from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type Personas } from "./personas";

let t: TestApp;
let p: Personas;
let intake: Intake;

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await t.request({
    method: "PATCH",
    url: "/api/v1/settings",
    headers: { ...p.sysAdmin.headers, "if-match": '"1"' },
    payload: { statementOfFaithUrl: "https://glim.edu.ng/statement-of-faith" },
  });
});

afterAll(async () => {
  await t.close();
});

const officer = () => p.admOfficer.headers;
const current = async () =>
  (await t.request({ url: "/api/v1/public/intakes/current" })).json<CurrentIntake>();

describe("intakes", () => {
  it("are planned by the Admissions Officer with application dates and the cohort's start date", async () => {
    const plan = (payload: object) =>
      t.request({ method: "POST", url: "/api/v1/intakes", headers: officer(), payload });
    const backwards = await plan({
      code: "2027",
      opensOn: "2027-06-30",
      closesOn: "2026-11-01",
      startsOn: "2027-09-01",
    });
    expect(backwards.statusCode).toBe(400);
    const startsBeforeOpening = await plan({
      code: "2027",
      opensOn: "2026-11-01",
      closesOn: "2027-06-30",
      startsOn: "2026-10-01",
    });
    expect(startsBeforeOpening.statusCode).toBe(400);
    expect((await plan({ code: "2027", opensOn: "2026-11-01", closesOn: "2027-06-30" })).statusCode).toBe(400);
    expect(
      (await t.request({ method: "POST", url: "/api/v1/intakes", headers: p.acadAdmin.headers, payload: {} }))
        .statusCode,
    ).toBe(403);

    const res = await plan({
      code: "2027",
      opensOn: "2026-11-01",
      closesOn: "2027-06-30",
      startsOn: "2027-09-01",
    });
    expect(res.statusCode).toBe(201);
    intake = res.json<Intake>();
    expect(intake).toMatchObject({
      code: "2027",
      status: "PLANNED",
      offerAcceptanceDays: 21,
      startsOn: "2027-09-01",
    });

    // Several a year (ADR-0005), but their application windows can't overlap.
    const overlapping = await plan({
      code: "2028-JAN",
      opensOn: "2027-06-01",
      closesOn: "2027-10-31",
      startsOn: "2028-01-10",
    });
    expect(overlapping.statusCode).toBe(409);
    expect(overlapping.json()).toMatchObject({ error: { code: "INTAKE_OVERLAP" } });
    const january = await plan({
      code: "2028-JAN",
      opensOn: "2027-07-01",
      closesOn: "2027-10-31",
      startsOn: "2028-01-10",
    });
    expect(january.statusCode, january.body).toBe(201);
    const sameCode = await plan({
      code: "2027",
      opensOn: "2025-11-01",
      closesOn: "2026-06-30",
      startsOn: "2026-09-01",
    });
    expect(sameCode.statusCode).toBe(409);
  });

  it("are shown to applicants without signing in, with the programmes and the Statement of Faith", async () => {
    const shown = await current();
    expect(shown.intake).toEqual({
      code: "2027",
      opensOn: "2026-11-01",
      closesOn: "2027-06-30",
      startsOn: "2027-09-01",
      status: "PLANNED",
    });
    // Only programmes taking applications: the personas' is archived.
    expect(shown.programmes.map((pr) => pr.code)).not.toContain("PDIP");
    expect(shown.statementOfFaithUrl).toBe("https://glim.edu.ng/statement-of-faith");
  });

  it("can be opened and closed early by hand, after which applicants see the next intake", async () => {
    const opened = await t.request({
      method: "POST",
      url: `/api/v1/intakes/${intake.id}/open`,
      headers: officer(),
    });
    expect(opened.json()).toMatchObject({ status: "OPEN" });
    expect((await current()).intake?.status).toBe("OPEN");

    const closed = await t.request({
      method: "POST",
      url: `/api/v1/intakes/${intake.id}/close`,
      headers: officer(),
    });
    expect(closed.json()).toMatchObject({ status: "CLOSED" });
    // Applicants then see the next intake planned.
    expect((await current()).intake).toMatchObject({ code: "2028-JAN", status: "PLANNED" });

    const reopen = await t.request({
      method: "POST",
      url: `/api/v1/intakes/${intake.id}/open`,
      headers: officer(),
    });
    expect(reopen.statusCode).toBe(409);
    const edit = await t.request({
      method: "PATCH",
      url: `/api/v1/intakes/${intake.id}`,
      headers: { ...officer(), "if-match": '"3"' },
      payload: { offerAcceptanceDays: 30 },
    });
    expect(edit.statusCode).toBe(409);
  });
});
