import type { TranscriptSnapshot } from "@glim/contracts";
import { schema, type Database } from "@glim/db";
import {
  cumulativeGpa,
  rulesOf,
  semesterGpa,
  standingFor,
  type ResultKind,
  type ResultLine,
} from "@glim/modules/results";
import { domainError, err, ok, type DomainResult } from "@glim/shared";
import { and, asc, eq, ne } from "drizzle-orm";

type ResultRow = typeof schema.courseResults.$inferSelect;

const notIssuable = (message: string) => err(domainError("TRANSCRIPT_NOT_ISSUABLE", message));

function lineOf(row: ResultRow): ResultLine {
  return {
    courseId: row.courseId,
    attemptOrder: row.attemptNo,
    creditsX10: row.creditsX10,
    pointsX100: row.pointsX100,
    qualityPointsX1000: row.qualityPointsX1000 ?? 0,
    resultKind: row.resultKind as ResultKind,
    countsInGpa: row.countsInGpa,
    passed: row.passed,
  };
}

/**
 * Builds a transcript's snapshot (TRD §14.7) from the programme enrollment's records as they are
 * now. An OFFICIAL transcript needs every semester with results approved or published
 * (`TRANSCRIPT_NOT_ISSUABLE` otherwise); an UNOFFICIAL one shows finalized results and marks
 * unapproved semesters Provisional. Figures are recomputed with the pure functions, so they match
 * the semester results exactly.
 */
export async function buildSnapshot(
  db: Database,
  programmeEnrollmentId: string,
  kind: "OFFICIAL" | "UNOFFICIAL",
  asOf: string,
): Promise<DomainResult<TranscriptSnapshot>> {
  const pe = schema.programmeEnrollments;
  const p = schema.programmes;
  const st = schema.students;
  const [enrollment] = await db
    .select({
      matricNumber: pe.matricNumber,
      programmeCode: p.code,
      programmeName: p.name,
      awardType: p.awardType,
      schemeId: p.gradingSchemeId,
      given: st.givenName,
      middle: st.middleName,
      family: st.familyName,
    })
    .from(pe)
    .innerJoin(p, eq(p.id, pe.programmeId))
    .innerJoin(st, eq(st.id, pe.studentId))
    .where(eq(pe.id, programmeEnrollmentId));
  if (enrollment === undefined) return err(domainError("NOT_FOUND", "Not found."));
  if (enrollment.schemeId === null) return notIssuable("The programme has no grading scheme yet.");
  const [scheme] = await db
    .select()
    .from(schema.gradingSchemes)
    .where(eq(schema.gradingSchemes.id, enrollment.schemeId));
  if (scheme === undefined) return notIssuable("The programme's grading scheme is missing.");
  const rules = rulesOf(scheme);
  const [settings] = await db.select({ name: schema.settings.name }).from(schema.settings).limit(1);

  const r = schema.courseResults;
  const c = schema.courses;
  const s = schema.semesters;
  const ses = schema.academicSessions;
  const rows = await db
    .select({
      result: r,
      code: c.code,
      title: c.title,
      semesterName: s.name,
      sessionCode: ses.code,
    })
    .from(r)
    .innerJoin(c, eq(c.id, r.courseId))
    .innerJoin(s, eq(s.id, r.semesterId))
    .innerJoin(ses, eq(ses.id, s.academicSessionId))
    .where(and(eq(r.programmeEnrollmentId, programmeEnrollmentId), ne(r.status, "DRAFT")))
    .orderBy(asc(ses.startsOn), asc(s.sequence), asc(c.code), asc(r.attemptNo));
  const sr = schema.semesterResults;
  const semesterStatuses = await db
    .select({ semesterId: sr.semesterId, status: sr.status })
    .from(sr)
    .where(eq(sr.programmeEnrollmentId, programmeEnrollmentId));
  const approved = (semesterId: string) =>
    ["APPROVED", "PUBLISHED"].includes(
      semesterStatuses.find((x) => x.semesterId === semesterId)?.status ?? "",
    );

  const semesterIds = [...new Set(rows.map((x) => x.result.semesterId))];
  if (kind === "OFFICIAL") {
    if (semesterIds.length === 0) return notIssuable("There are no results to put on it yet.");
    const pending = semesterIds.filter((id) => !approved(id));
    if (pending.length > 0)
      return notIssuable(
        `An official transcript needs every semester approved by the Registrar; ${String(pending.length)} isn't yet.`,
      );
  }

  // An attempt is "repeated" when a later attempt of the course exists.
  const latestAttempt = new Map<string, number>();
  for (const { result } of rows)
    latestAttempt.set(
      result.courseId,
      Math.max(latestAttempt.get(result.courseId) ?? 0, result.attemptNo),
    );

  const sofar: ResultLine[] = [];
  const semesters: TranscriptSnapshot["semesters"] = semesterIds.map((semesterId) => {
    const inSemester = rows.filter((x) => x.result.semesterId === semesterId);
    const lines = inSemester.map((x) => lineOf(x.result));
    sofar.push(...lines);
    const term = semesterGpa(lines);
    const cum = cumulativeGpa(sofar, rules.repeatPolicy);
    const first = inSemester[0];
    return {
      sessionCode: first?.sessionCode ?? "",
      semesterName: first?.semesterName ?? "",
      provisional: !approved(semesterId),
      courses: inSemester.map((x) => ({
        code: x.code,
        title: x.title,
        creditsX10: x.result.creditsX10,
        finalPctX100: x.result.finalPctX100,
        letter: x.result.letter,
        pointsX100: x.result.pointsX100,
        resultKind: x.result.resultKind as ResultKind,
        attemptNo: x.result.attemptNo,
        repeated: (latestAttempt.get(x.result.courseId) ?? 0) > x.result.attemptNo,
        imported: x.result.source === "IMPORT",
      })),
      creditsAttemptedX10: term.creditsAttemptedX10,
      creditsEarnedX10: term.creditsEarnedX10,
      gpaX100: term.gpaX100,
      cgpaX100: cum.gpaX100,
      standing: standingFor(cum.gpaX100, rules),
    };
  });
  const total = cumulativeGpa(sofar, rules.repeatPolicy);

  const a = schema.awards;
  const [award] = await db
    .select()
    .from(a)
    .where(and(eq(a.programmeEnrollmentId, programmeEnrollmentId), eq(a.status, "CONFERRED")));

  return ok({
    version: 1,
    kind,
    asOf,
    institution: { name: settings?.name ?? "GLIM Online Bible College" },
    programme: {
      code: enrollment.programmeCode,
      name: enrollment.programmeName,
      awardType: enrollment.awardType as TranscriptSnapshot["programme"]["awardType"],
    },
    student: {
      legalName: [enrollment.given, enrollment.middle, enrollment.family]
        .filter((x): x is string => x !== null && x !== "")
        .join(" "),
      matricNumber: enrollment.matricNumber,
    },
    semesters,
    totals: {
      creditsAttemptedX10: total.creditsAttemptedX10,
      creditsEarnedX10: total.creditsEarnedX10,
      cgpaX100: total.gpaX100,
      standing: standingFor(total.gpaX100, rules),
    },
    award:
      award?.awardClass != null && award.certificateNo !== null && award.awardedOn !== null
        ? {
            awardClass: award.awardClass,
            certificateNo: award.certificateNo,
            awardedOn: award.awardedOn,
          }
        : null,
    legend: {
      bands: rules.bands,
      classBands: rules.classBands,
      minAwardCgpaX100: rules.minAwardCgpaX100,
      repeatPolicy: rules.repeatPolicy,
    },
  });
}
