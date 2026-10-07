import type { AcademicSession, CurrentIntake, Intake } from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type Personas } from "./personas";

let t: TestApp;
let p: Personas;
let session: AcademicSession;
let intake: Intake;

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  session = (
    await t.request({
      method: "POST",
      url: "/api/v1/academic-sessions",
      headers: p.acadAdmin.headers,
      payload: {
        code: "2027/2028",
        name: "2027/2028 Session",
        startsOn: "2027-09-01",
        endsOn: "2028-06-30",
      },
    })
  ).json<AcademicSession>();
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
  it("are planned by the Admissions Officer for an Academic Session, closing before it starts", async () => {
    const late = await t.request({
      method: "POST",
      url: "/api/v1/intakes",
      headers: officer(),
      payload: {
        code: "2027",
        academicSessionId: session.id,
        opensOn: "2026-11-01",
        closesOn: "2027-09-15",
      },
    });
    expect(late.statusCode).toBe(400);

    const res = await t.request({
      method: "POST",
      url: "/api/v1/intakes",
      headers: officer(),
      payload: {
        code: "2027",
        academicSessionId: session.id,
        opensOn: "2026-11-01",
        closesOn: "2027-06-30",
      },
    });
    expect(res.statusCode).toBe(201);
    intake = res.json<Intake>();
    expect(intake).toMatchObject({
      code: "2027",
      status: "PLANNED",
      offerAcceptanceDays: 21,
      academicSessionName: "2027/2028 Session",
    });

    const second = await t.request({
      method: "POST",
      url: "/api/v1/intakes",
      headers: officer(),
      payload: {
        code: "2028",
        academicSessionId: session.id,
        opensOn: "2025-11-01",
        closesOn: "2026-06-30",
      },
    });
    expect(second.statusCode).toBe(409);
  });

  it("are shown to applicants without signing in, with the programmes and the Statement of Faith", async () => {
    const shown = await current();
    expect(shown.intake).toEqual({
      code: "2027",
      academicSessionName: "2027/2028 Session",
      opensOn: "2026-11-01",
      closesOn: "2027-06-30",
      status: "PLANNED",
    });
    expect(shown.programmes.map((pr) => pr.code)).toContain("PDIP");
    expect(shown.statementOfFaithUrl).toBe("https://glim.edu.ng/statement-of-faith");
  });

  it("can be opened and closed early by hand, and the closed state is what applicants see", async () => {
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
    expect((await current()).intake?.status).toBe("CLOSED");

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
