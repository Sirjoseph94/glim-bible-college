import type { Course, CurriculumDetail, Intake, Programme } from "@glim/contracts";
import { expect } from "vitest";
import type { TestApp } from "./harness";
import type { Personas } from "./personas";

export interface AdmissionsWorld {
  /** The Diploma's curriculum, in order: BIB101 then THE101. */
  courses: { bible: Course; doctrine: Course };
  diploma: Programme;
  intake: Intake;
}

/**
 * What applicants need (ADR-0005): the Diploma (DIP) with an ACTIVE curriculum of two courses,
 * and the 2027 intake, open, whose cohort starts on 2027-09-01.
 */
export async function admissionsWorld(t: TestApp, p: Personas): Promise<AdmissionsWorld> {
  const acad = p.acadAdmin.headers;
  // T only names the expected body shape for the caller, as res.json<T>() does.

  const send = async <T>(method: "POST" | "PUT", url: string, payload?: unknown, extra = {}) => {
    const res = await t.request({ method, url, headers: { ...acad, ...extra }, payload });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return res.json<T>();
  };
  const course = await send<Course>("POST", "/api/v1/courses", {
    code: "BIB101",
    title: "Introduction to the Bible",
    credits: "3",
  });
  const doctrine = await send<Course>("POST", "/api/v1/courses", {
    code: "THE101",
    title: "Christian Doctrine",
    credits: "3",
  });
  const diploma = await send<Programme>("POST", "/api/v1/programmes", {
    code: "DIP",
    name: "Diploma in Theology",
  });
  const draft = await send<CurriculumDetail>("POST", "/api/v1/curricula", {
    programmeId: diploma.id,
    effectiveFrom: "2026-09-01",
  });
  await send(
    "PUT",
    `/api/v1/curricula/${draft.id}/courses`,
    { placements: [course, doctrine].map((c) => ({ courseId: c.id })) },
    { "if-match": `"${String(draft.version)}"` },
  );
  await send("POST", `/api/v1/curricula/${draft.id}/activate`);
  const officer = p.admOfficer.headers;
  const intake = (
    await t.request({
      method: "POST",
      url: "/api/v1/intakes",
      headers: officer,
      payload: {
        code: "2027",
        opensOn: "2026-11-01",
        closesOn: "2027-06-30",
        startsOn: "2027-09-01",
      },
    })
  ).json<Intake>();
  await t.request({ method: "POST", url: `/api/v1/intakes/${intake.id}/open`, headers: officer });
  return { courses: { bible: course, doctrine }, diploma, intake };
}
