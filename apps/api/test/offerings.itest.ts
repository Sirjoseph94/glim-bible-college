import type { Course, Lecturer, Me, Offering } from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, createUser, sessionFor, type Personas } from "./personas";

let t: TestApp;
let p: Personas;
let course: Course;
let ada: Lecturer;
let bola: Lecturer;
let chi: Lecturer;

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  course = (
    await post<Course>("/api/v1/courses", {
      code: "THE201",
      title: "Christian Doctrine",
      credits: "3",
    })
  ).body;
});

afterAll(async () => {
  await t.close();
});

const acad = () => p.acadAdmin.headers;

// T only names the expected body shape for the caller, as res.json<T>() does.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
async function post<T>(
  url: string,
  payload?: unknown,
  headers = acad(),
): Promise<{ status: number; body: T }> {
  const res = await t.request({ method: "POST", url, payload, headers });
  return { status: res.statusCode, body: res.json<T>() };
}

describe("Lecturers", () => {
  it("link an existing account, or invite a new person by email", async () => {
    await createUser(t, { email: "ada@glim.edu.ng", displayName: "Ada" });
    const linked = await post<{ lecturer: Lecturer; invited: boolean }>("/api/v1/lecturers", {
      email: "ada@glim.edu.ng",
      title: "Rev",
      givenName: "Ada",
      familyName: "Okafor",
    });
    expect(linked.body).toMatchObject({
      invited: false,
      lecturer: { displayName: "Rev Ada Okafor", kind: "INTERNAL", status: "ACTIVE" },
    });
    ada = linked.body.lecturer;

    const invited = await post<{ lecturer: Lecturer; invited: boolean }>("/api/v1/lecturers", {
      email: "bola.guest@gmail.com",
      givenName: "Bola",
      familyName: "Adeyemi",
      kind: "GUEST",
    });
    expect(invited.body.invited).toBe(true);
    expect(t.mailer.lastTo("bola.guest@gmail.com")?.text).toMatch(/\/invite\//);
    bola = invited.body.lecturer;

    await createUser(t, { email: "chi@glim.edu.ng" });
    chi = (
      await post<{ lecturer: Lecturer }>("/api/v1/lecturers", {
        email: "chi@glim.edu.ng",
        givenName: "Chi",
        familyName: "Eze",
      })
    ).body.lecturer;

    const again = await post("/api/v1/lecturers", {
      email: "ADA@glim.edu.ng",
      givenName: "Ada",
      familyName: "Okafor",
    });
    expect(again.status).toBe(409);
  });
});

describe("Course Offerings", () => {
  let offering: Offering;

  it("are created for a semester with their Lecturers, Primary first", async () => {
    const created = await post<Offering>("/api/v1/course-offerings", {
      courseId: course.id,
      semesterId: p.world.semesterId,
      lecturers: [
        { lecturerId: bola.id, role: "GUEST_LECTURER" },
        { lecturerId: ada.id, role: "PRIMARY" },
      ],
    });
    expect(created.status).toBe(201);
    offering = created.body;
    expect(offering).toMatchObject({
      courseCode: "THE201",
      title: "Christian Doctrine",
      sectionCode: "01",
      status: "DRAFT",
      credits: "3.0",
    });
    expect(offering.lecturers.map((l) => [l.lecturerName, l.role])).toEqual([
      ["Rev Ada Okafor", "PRIMARY"],
      ["Bola Adeyemi", "GUEST_LECTURER"],
    ]);

    const duplicate = await post("/api/v1/course-offerings", {
      courseId: course.id,
      semesterId: p.world.semesterId,
    });
    expect(duplicate.status).toBe(409);
    const twoPrimaries = await post("/api/v1/course-offerings", {
      courseId: course.id,
      semesterId: p.world.semesterId,
      sectionCode: "02",
      lecturers: [
        { lecturerId: ada.id, role: "PRIMARY" },
        { lecturerId: chi.id, role: "PRIMARY" },
      ],
    });
    expect(twoPrimaries.status).toBe(400);
  });

  it("can't be published without an active Primary Lecturer", async () => {
    const unstaffed = (
      await post<Offering>("/api/v1/course-offerings", {
        courseId: course.id,
        semesterId: p.world.semesterId,
        sectionCode: "03",
      })
    ).body;
    const res = await post(`/api/v1/course-offerings/${unstaffed.id}/publish`);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: "PRIMARY_REQUIRED" } });

    const published = await post<Offering>(`/api/v1/course-offerings/${offering.id}/publish`);
    expect(published.body.status).toBe("PUBLISHED");
  });

  it("swap the Primary in one step, and refuse to leave a published offering without one", async () => {
    const swapped = await post<Offering>(`/api/v1/course-offerings/${offering.id}/lecturers`, {
      lecturerId: chi.id,
      role: "PRIMARY",
    });
    expect(swapped.body.lecturers.map((l) => [l.lecturerName, l.role])).toEqual([
      ["Chi Eze", "PRIMARY"],
      ["Bola Adeyemi", "GUEST_LECTURER"],
    ]);
    const history = await t.request({
      url: `/api/v1/course-offerings/${offering.id}/lecturers`,
      headers: acad(),
    });
    expect(history.json<{ items: { lecturerName: string; status: string }[] }>().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lecturerName: "Rev Ada Okafor", status: "ENDED" }),
      ]),
    );

    const primary = swapped.body.lecturers.find((l) => l.role === "PRIMARY");
    const end = await t.request({
      method: "DELETE",
      url: `/api/v1/course-offerings/${offering.id}/lecturers/${primary?.id ?? ""}`,
      headers: acad(),
    });
    expect(end.statusCode).toBe(422);
    expect(end.json()).toMatchObject({ error: { code: "PRIMARY_REQUIRED" } });

    const guest = swapped.body.lecturers.find((l) => l.role === "GUEST_LECTURER");
    const endGuest = await t.request({
      method: "DELETE",
      url: `/api/v1/course-offerings/${offering.id}/lecturers/${guest?.id ?? ""}`,
      headers: acad(),
    });
    expect(endGuest.statusCode).toBe(204);

    const twice = await post(`/api/v1/course-offerings/${offering.id}/lecturers`, {
      lecturerId: chi.id,
      role: "ASSISTANT",
    });
    expect(twice.status).toBe(409);
  });

  it("show each Lecturer the offerings they teach, and academic staff all of them", async () => {
    const chiUser = (await t.request({ url: "/api/v1/lecturers", headers: acad() }))
      .json<{ items: Lecturer[] }>()
      .items.find((l) => l.id === chi.id);
    const chiHeaders = await sessionFor(t, chiUser?.userId ?? "");
    const mine = await t.request({ url: "/api/v1/course-offerings", headers: chiHeaders });
    expect(mine.json<{ items: Offering[] }>().items.map((o) => o.id)).toEqual([offering.id]);
    expect(
      (await t.request({ url: "/api/v1/me", headers: chiHeaders })).json<Me>().roles.isLecturer,
    ).toBe(true);

    const other = await t.request({
      url: `/api/v1/course-offerings/${p.world.offerings.O2}`,
      headers: chiHeaders,
    });
    expect(other.statusCode).toBe(404);

    const all = await t.request({
      url: `/api/v1/course-offerings?semesterId=${p.world.semesterId}`,
      headers: p.registrar.headers,
    });
    expect(all.json<{ items: Offering[] }>().items.length).toBeGreaterThanOrEqual(4);

    const nobody = await t.request({ url: "/api/v1/course-offerings", headers: p.noRole.headers });
    expect(nobody.json()).toEqual({ items: [] });
  });

  it("can be cancelled with a reason, after which nobody can be assigned", async () => {
    const cancelled = await post<Offering>(`/api/v1/course-offerings/${offering.id}/cancel`, {
      reason: "Too few students",
    });
    expect(cancelled.body.status).toBe("CANCELLED");
    const assign = await post(`/api/v1/course-offerings/${offering.id}/lecturers`, {
      lecturerId: ada.id,
      role: "CO_LECTURER",
    });
    expect(assign.status).toBe(409);
  });
});
