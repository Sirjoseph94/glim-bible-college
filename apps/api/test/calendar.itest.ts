import type { AcademicSession, Room, Semester } from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type Persona, type PersonaName } from "./personas";

let t: TestApp;
let p: Record<PersonaName, Persona>;
let session: AcademicSession;
let first: Semester;
let second: Semester;

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
});

afterAll(async () => {
  await t.close();
});

const acad = () => p.acadAdmin.headers;

function post(url: string, payload?: unknown) {
  return t.request({ method: "POST", url, payload, headers: acad() });
}

describe("Academic Sessions", () => {
  it("are planned for September to June, and only one is active at a time", async () => {
    const created = await post("/api/v1/academic-sessions", {
      code: "2026/2027",
      name: "2026/2027 Session",
      startsOn: "2026-09-01",
      endsOn: "2027-06-30",
    });
    expect(created.statusCode).toBe(201);
    session = created.json<AcademicSession>();
    expect(session).toMatchObject({
      status: "PLANNED",
      startsOn: "2026-09-01",
      endsOn: "2027-06-30",
    });

    const next = (
      await post("/api/v1/academic-sessions", {
        code: "2027/2028",
        name: "2027/2028 Session",
        startsOn: "2027-09-01",
        endsOn: "2028-06-30",
      })
    ).json<AcademicSession>();

    expect((await post(`/api/v1/academic-sessions/${session.id}/activate`)).json()).toMatchObject({
      status: "ACTIVE",
    });
    const second = await post(`/api/v1/academic-sessions/${next.id}/activate`);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      error: { message: "Another Academic Session is active. Close it first." },
    });
  });

  it("can't overlap, and only a planned session's dates can change", async () => {
    const overlapping = await post("/api/v1/academic-sessions", {
      code: "2025/2026",
      name: "Overlap",
      startsOn: "2026-01-01",
      endsOn: "2026-10-01",
    });
    expect(overlapping.statusCode).toBe(409);
    const badCode = await post("/api/v1/academic-sessions", {
      code: "2026-27",
      name: "Bad",
      startsOn: "2029-09-01",
      endsOn: "2030-06-30",
    });
    expect(badCode.statusCode).toBe(400);
    const edit = await t.request({
      method: "PATCH",
      url: `/api/v1/academic-sessions/${session.id}`,
      headers: { ...acad(), "if-match": `"${String(session.version + 1)}"` },
      payload: { name: "Renamed" },
    });
    expect(edit.statusCode).toBe(409);
  });
});

describe("semesters", () => {
  it("sit inside their session, with exams and the add/drop deadline inside the semester", async () => {
    const created = await post("/api/v1/semesters", {
      academicSessionId: session.id,
      code: "S1",
      name: "First Semester",
      sequence: 1,
      startsOn: "2026-09-07",
      endsOn: "2027-01-29",
      registrationOpensOn: "2026-08-24",
      registrationClosesOn: "2026-09-18",
      addDropDeadlineOn: "2026-09-25",
      examsStartOn: "2027-01-11",
      examsEndOn: "2027-01-22",
    });
    expect(created.statusCode).toBe(201);
    first = created.json<Semester>();

    const outside = await post("/api/v1/semesters", {
      academicSessionId: session.id,
      code: "S2",
      name: "Second",
      sequence: 2,
      startsOn: "2027-02-01",
      endsOn: "2027-07-31",
    });
    expect(outside.statusCode).toBe(400);

    const examsAfterEnd = await post("/api/v1/semesters", {
      academicSessionId: session.id,
      code: "S2",
      name: "Second",
      sequence: 2,
      startsOn: "2027-02-01",
      endsOn: "2027-06-25",
      examsStartOn: "2027-06-14",
      examsEndOn: "2027-06-30",
    });
    expect(examsAfterEnd.statusCode).toBe(400);

    const overlapping = await post("/api/v1/semesters", {
      academicSessionId: session.id,
      code: "S2",
      name: "Second",
      sequence: 2,
      startsOn: "2027-01-15",
      endsOn: "2027-06-25",
    });
    expect(overlapping.statusCode).toBe(409);

    const ok = await post("/api/v1/semesters", {
      academicSessionId: session.id,
      code: "S2",
      name: "Second Semester",
      sequence: 2,
      startsOn: "2027-02-01",
      endsOn: "2027-06-25",
      examsStartOn: "2027-06-07",
      examsEndOn: "2027-06-18",
    });
    expect(ok.statusCode).toBe(201);
    second = ok.json<Semester>();

    const listed = await t.request({
      url: `/api/v1/semesters?sessionId=${session.id}`,
      headers: p.registrar.headers,
    });
    expect(listed.json<{ items: Semester[] }>().items.map((s) => s.code)).toEqual(["S1", "S2"]);
  });

  it("move planned → registration → active → closed, and nothing else", async () => {
    const skip = await post(`/api/v1/semesters/${first.id}/activate`);
    expect(skip.statusCode).toBe(409);
    expect(skip.json()).toMatchObject({ error: { code: "SEMESTER_STATE_INVALID" } });

    expect((await post(`/api/v1/semesters/${first.id}/open-registration`)).json()).toMatchObject({
      status: "REGISTRATION",
    });
    expect((await post(`/api/v1/semesters/${first.id}/activate`)).json()).toMatchObject({
      status: "ACTIVE",
    });
    expect((await post(`/api/v1/semesters/${first.id}/close`)).json()).toMatchObject({
      status: "CLOSED",
    });

    const edit = await t.request({
      method: "PATCH",
      url: `/api/v1/semesters/${first.id}`,
      headers: { ...acad(), "if-match": '"4"' },
      payload: { name: "Too late" },
    });
    expect(edit.statusCode).toBe(409);
  });

  it("can't open registration until their session is active", async () => {
    const future = (
      await post("/api/v1/academic-sessions", {
        code: "2028/2029",
        name: "2028/2029 Session",
        startsOn: "2028-09-01",
        endsOn: "2029-06-30",
      })
    ).json<AcademicSession>();
    const sem = (
      await post("/api/v1/semesters", {
        academicSessionId: future.id,
        code: "S1",
        name: "First",
        sequence: 1,
        startsOn: "2028-09-04",
        endsOn: "2029-01-26",
      })
    ).json<Semester>();
    const res = await post(`/api/v1/semesters/${sem.id}/open-registration`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: "SEMESTER_STATE_INVALID" } });
  });

  it("must all be closed before their session closes", async () => {
    expect((await post(`/api/v1/academic-sessions/${session.id}/close`)).statusCode).toBe(409);
    await post(`/api/v1/semesters/${second.id}/open-registration`);
    await post(`/api/v1/semesters/${second.id}/activate`);
    await post(`/api/v1/semesters/${second.id}/close`);
    expect((await post(`/api/v1/academic-sessions/${session.id}/close`)).json()).toMatchObject({
      status: "CLOSED",
    });
  });
});

describe("Rooms", () => {
  it("are created, resized and archived", async () => {
    const hall = (
      await post("/api/v1/rooms", { code: "R1", name: "Main Hall", capacity: 40 })
    ).json<Room>();
    expect(hall).toMatchObject({ code: "R1", capacity: 40, status: "ACTIVE" });
    expect((await post("/api/v1/rooms", { code: "r1", name: "Duplicate" })).statusCode).toBe(409);

    const archived = await t.request({
      method: "PATCH",
      url: `/api/v1/rooms/${hall.id}`,
      headers: { ...acad(), "if-match": '"1"' },
      payload: { capacity: null, status: "ARCHIVED" },
    });
    expect(archived.json()).toMatchObject({ capacity: null, status: "ARCHIVED", version: 2 });

    const list = await t.request({ url: "/api/v1/rooms", headers: p.admOfficer.headers });
    expect(list.json<{ items: Room[] }>().items.map((r) => r.code)).toEqual(["R1"]);
  });
});
