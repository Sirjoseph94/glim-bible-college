import type { Course, CurriculumDetail, Programme } from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type Persona, type PersonaName } from "./personas";

let t: TestApp;
let p: Record<PersonaName, Persona>;
let diploma: Programme;
const courses: Record<string, Course> = {};

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
});

afterAll(async () => {
  await t.close();
});

const acad = () => p.acadAdmin.headers;

async function post<T>(url: string, payload: unknown, headers = acad()): Promise<T> {
  const res = await t.request({ method: "POST", url, payload, headers });
  if (res.statusCode >= 300) throw new Error(`${url}: ${String(res.statusCode)} ${res.body}`);
  return res.json<T>();
}

describe("programmes", () => {
  it("are created by the Academic Admin and readable by any staff member", async () => {
    diploma = await post<Programme>("/api/v1/programmes", {
      code: "DIP",
      name: "Diploma in Theology",
      awardType: "DIPLOMA",
      durationSemesters: 4,
      levels: 2,
    });
    expect(diploma).toMatchObject({ code: "DIP", levels: 2, status: "ACTIVE", version: 1 });
    await post("/api/v1/programmes", {
      code: "CERT",
      name: "Certificate in Theology",
      awardType: "CERTIFICATE",
      durationSemesters: 2,
      levels: 1,
    });

    const list = await t.request({ url: "/api/v1/programmes", headers: p.registrar.headers });
    expect(list.json<{ items: Programme[] }>().items.map((i) => i.code)).toEqual(["CERT", "DIP"]);
  });

  it("refuse a duplicate code and a stale edit", async () => {
    const dup = await t.request({
      method: "POST",
      url: "/api/v1/programmes",
      headers: acad(),
      payload: {
        code: "dip",
        name: "Again",
        awardType: "DIPLOMA",
        durationSemesters: 4,
        levels: 2,
      },
    });
    expect(dup.statusCode).toBe(409);
    const renamed = await t.request({
      method: "PATCH",
      url: `/api/v1/programmes/${diploma.id}`,
      headers: { ...acad(), "if-match": '"1"' },
      payload: { name: "Diploma in Theology and Ministry" },
    });
    expect(renamed.json()).toMatchObject({ name: "Diploma in Theology and Ministry", version: 2 });
    const stale = await t.request({
      method: "PATCH",
      url: `/api/v1/programmes/${diploma.id}`,
      headers: { ...acad(), "if-match": '"1"' },
      payload: { name: "Lost" },
    });
    expect(stale.statusCode).toBe(412);
  });
});

describe("courses", () => {
  it("keep credits exact and are searchable", async () => {
    for (const [code, title, credits] of [
      ["BIB101", "Old Testament Survey", "3"],
      ["BIB102", "New Testament Survey", "3.0"],
      ["THE101", "Systematic Theology I", "2.5"],
      ["MIN201", "Pastoral Ministry", "2"],
      ["MIS201", "Missions and Evangelism", "2"],
    ] as const) {
      courses[code] = await post<Course>("/api/v1/courses", { code, title, credits });
    }
    expect(courses.BIB101?.credits).toBe("3.0");
    expect(courses.THE101?.credits).toBe("2.5");

    const found = await t.request({
      url: "/api/v1/courses?q=survey",
      headers: p.admOfficer.headers,
    });
    expect(found.json<{ items: Course[] }>().items.map((c) => c.code)).toEqual([
      "BIB101",
      "BIB102",
    ]);

    const bad = await t.request({
      method: "POST",
      url: "/api/v1/courses",
      headers: acad(),
      payload: { code: "X1", title: "X", credits: "2.55" },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("curricula", () => {
  let v1: CurriculumDetail;

  it("start as a draft whose placements are edited as a whole, then activate", async () => {
    v1 = await post<CurriculumDetail>("/api/v1/curricula", {
      programmeId: diploma.id,
      effectiveFrom: "2026-09-01",
      minElectiveCredits: "2",
    });
    expect(v1).toMatchObject({
      curriculumVersion: 1,
      status: "DRAFT",
      minElectiveCredits: "2.0",
      placements: [],
      locked: false,
    });

    const empty = await t.request({
      method: "POST",
      url: `/api/v1/curricula/${v1.id}/activate`,
      headers: acad(),
    });
    expect(empty.statusCode).toBe(409);

    const placed = await t.request({
      method: "PUT",
      url: `/api/v1/curricula/${v1.id}/courses`,
      headers: { ...acad(), "if-match": `"${String(v1.version)}"` },
      payload: {
        placements: [
          { courseId: courses.BIB101?.id, levelNo: 1, semesterNo: 1, courseType: "COMPULSORY" },
          {
            courseId: courses.THE101?.id,
            levelNo: 1,
            semesterNo: 2,
            courseType: "COMPULSORY",
            creditOverride: "3",
          },
          { courseId: courses.MIN201?.id, levelNo: 2, semesterNo: 1, courseType: "ELECTIVE" },
          { courseId: courses.MIS201?.id, levelNo: 2, semesterNo: 1, courseType: "ELECTIVE" },
        ],
      },
    });
    expect(placed.statusCode).toBe(200);
    v1 = placed.json<CurriculumDetail>();
    expect(
      v1.placements.map((pl) => [
        pl.courseCode,
        pl.levelNo,
        pl.semesterNo,
        pl.courseType,
        pl.credits,
      ]),
    ).toEqual([
      ["BIB101", 1, 1, "COMPULSORY", "3.0"],
      ["THE101", 1, 2, "COMPULSORY", "3.0"],
      ["MIN201", 2, 1, "ELECTIVE", "2.0"],
      ["MIS201", 2, 1, "ELECTIVE", "2.0"],
    ]);

    const active = await post<CurriculumDetail>(`/api/v1/curricula/${v1.id}/activate`, undefined);
    expect(active.status).toBe("ACTIVE");
  });

  it("reject placements that don't fit the programme", async () => {
    const draft = await post<CurriculumDetail>(`/api/v1/curricula/${v1.id}/clone`, {
      effectiveFrom: "2027-09-01",
    });
    const res = await t.request({
      method: "PUT",
      url: `/api/v1/curricula/${draft.id}/courses`,
      headers: { ...acad(), "if-match": `"${String(draft.version)}"` },
      payload: {
        placements: [
          { courseId: courses.BIB101?.id, levelNo: 3, semesterNo: 1, courseType: "COMPULSORY" },
          { courseId: courses.BIB101?.id, levelNo: 1, semesterNo: 2, courseType: "COMPULSORY" },
          {
            courseId: "0199b8a2-7c1e-7d3a-9f00-123456789abc",
            levelNo: 1,
            semesterNo: 1,
            courseType: "ELECTIVE",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(
      res
        .json<{ error: { fieldErrors: { path: string; code: string }[] } }>()
        .error.fieldErrors.map((f) => [f.path, f.code]),
    ).toEqual([
      ["body.placements.0.levelNo", "too_high"],
      ["body.placements.1.courseId", "duplicate"],
      ["body.placements.2.courseId", "not_found"],
    ]);
  });

  it("clone into the next version, and activating it retires the old one, which is then locked", async () => {
    const list = (
      await t.request({ url: `/api/v1/curricula?programmeId=${diploma.id}`, headers: acad() })
    ).json<{ items: CurriculumDetail[] }>();
    const v2 = list.items.find((c) => c.curriculumVersion === 2);
    expect(v2).toMatchObject({ status: "DRAFT", placementCount: 4, minElectiveCredits: "2.0" });

    const activated = await post<CurriculumDetail>(
      `/api/v1/curricula/${v2?.id ?? ""}/activate`,
      undefined,
    );
    expect(activated.status).toBe("ACTIVE");
    const old = (
      await t.request({ url: `/api/v1/curricula/${v1.id}`, headers: acad() })
    ).json<CurriculumDetail>();
    expect(old).toMatchObject({ status: "RETIRED", locked: true });

    const edit = await t.request({
      method: "PATCH",
      url: `/api/v1/curricula/${v1.id}`,
      headers: { ...acad(), "if-match": `"${String(old.version)}"` },
      payload: { minElectiveCredits: "4" },
    });
    expect(edit.statusCode).toBe(409);
    expect(edit.json()).toMatchObject({ error: { code: "CURRICULUM_LOCKED" } });
  });

  it("are listed per programme with their versions, oldest first", async () => {
    const list = (
      await t.request({
        url: `/api/v1/curricula?programmeId=${diploma.id}`,
        headers: p.registrar.headers,
      })
    ).json<{ items: CurriculumDetail[] }>();
    expect(list.items.map((c) => [c.curriculumVersion, c.status])).toEqual([
      [1, "RETIRED"],
      [2, "ACTIVE"],
    ]);
  });
});
