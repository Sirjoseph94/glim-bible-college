import type { AcademicSession, Course, CurriculumDetail, Intake, Programme } from "@glim/contracts";
import { expect } from "vitest";
import type { TestApp } from "./harness";
import type { Personas } from "./personas";

export interface AdmissionsWorld {
  /** BIB101 (both programmes, Level 1 semester 1); THE101 is in the Diploma only. */
  courses: { bible: Course; doctrine: Course };
  certificate: Programme;
  diploma: Programme;
  session: AcademicSession;
  intake: Intake;
}

/**
 * What applicants need: Certificate (CERT) and Diploma (DIP) programmes, each with an ACTIVE
 * curriculum, the 2027/2028 Academic Session, and its intake 2027, open.
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
  // The Diploma also has a compulsory course that nobody offers (for registration tests).
  const doctrine = await send<Course>("POST", "/api/v1/courses", {
    code: "THE101",
    title: "Christian Doctrine",
    credits: "3",
  });
  const programme = async (
    code: string,
    awardType: string,
    levels: number,
    extraCourses: Course[] = [],
  ) => {
    const created = await send<Programme>("POST", "/api/v1/programmes", {
      code,
      name: awardType === "DIPLOMA" ? "Diploma in Theology" : "Certificate in Theology",
      awardType,
      durationSemesters: 2 * levels,
      levels,
    });
    const draft = await send<CurriculumDetail>("POST", "/api/v1/curricula", {
      programmeId: created.id,
      effectiveFrom: "2026-09-01",
    });
    await send(
      "PUT",
      `/api/v1/curricula/${draft.id}/courses`,
      {
        placements: [course, ...extraCourses].map((c) => ({
          courseId: c.id,
          levelNo: 1,
          semesterNo: 1,
          courseType: "COMPULSORY",
        })),
      },
      { "if-match": `"${String(draft.version)}"` },
    );
    await send("POST", `/api/v1/curricula/${draft.id}/activate`);
    return created;
  };
  const certificate = await programme("CERT", "CERTIFICATE", 1);
  const diploma = await programme("DIP", "DIPLOMA", 2, [doctrine]);
  const session = await send<AcademicSession>("POST", "/api/v1/academic-sessions", {
    code: "2027/2028",
    name: "2027/2028 Session",
    startsOn: "2027-09-01",
    endsOn: "2028-06-30",
  });
  const officer = p.admOfficer.headers;
  const intake = (
    await t.request({
      method: "POST",
      url: "/api/v1/intakes",
      headers: officer,
      payload: {
        code: "2027",
        academicSessionId: session.id,
        opensOn: "2026-11-01",
        closesOn: "2027-06-30",
      },
    })
  ).json<Intake>();
  await t.request({ method: "POST", url: `/api/v1/intakes/${intake.id}/open`, headers: officer });
  return { courses: { bible: course, doctrine }, certificate, diploma, session, intake };
}
