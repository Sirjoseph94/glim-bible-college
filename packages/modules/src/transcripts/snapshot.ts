import type { TranscriptSnapshot } from "@glim/contracts";
import { schema, type Database } from "@glim/db";
import { rulesOf, summarize, type ResultKind } from "@glim/modules/results";
import { domainError, err, ok, type DomainResult } from "@glim/shared";
import { and, asc, eq, ne } from "drizzle-orm";

const notIssuable = (message: string) => err(domainError("TRANSCRIPT_NOT_ISSUABLE", message));

/**
 * Builds a transcript's snapshot (TRD §14.7) from the programme enrollment's records as they are
 * now: its courses in the order completed (ADR-0005). An OFFICIAL transcript needs every result
 * approved by the Registrar (`TRANSCRIPT_NOT_ISSUABLE` otherwise); an UNOFFICIAL one shows
 * finalized results and marks unapproved ones Provisional. Figures are recomputed with the pure
 * functions, so they match what students and the Registrar see.
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
  const rows = await db
    .select({ result: r, code: c.code, title: c.title })
    .from(r)
    .innerJoin(c, eq(c.id, r.courseId))
    .where(and(eq(r.programmeEnrollmentId, programmeEnrollmentId), ne(r.status, "DRAFT")))
    .orderBy(asc(r.completedOn), asc(c.code), asc(r.attemptNo));
  if (kind === "OFFICIAL") {
    if (rows.length === 0) return notIssuable("There are no results to put on it yet.");
    // Every result the CGPA counts must be approved (the same rule as awards, ADR-0005).
    const pending = rows.filter(
      (x) =>
        x.result.resultKind === "GRADED" && x.result.countsInGpa && x.result.status !== "APPROVED",
    ).length;
    if (pending > 0)
      return notIssuable(
        `An official transcript needs every result approved by the Registrar; ${String(pending)} isn't yet.`,
      );
  }

  // An attempt is "repeated" when a later attempt of the course exists.
  const latestAttempt = new Map<string, number>();
  for (const { result } of rows)
    latestAttempt.set(
      result.courseId,
      Math.max(latestAttempt.get(result.courseId) ?? 0, result.attemptNo),
    );
  const total = summarize(
    rows.map((x) => x.result),
    rules,
  );

  const a = schema.awards;
  const awards = await db
    .select()
    .from(a)
    .where(and(eq(a.programmeEnrollmentId, programmeEnrollmentId), eq(a.status, "CONFERRED")))
    .orderBy(asc(a.awardType));

  return ok({
    version: 2,
    kind,
    asOf,
    institution: { name: settings?.name ?? "GLIM Online Bible College" },
    programme: {
      code: enrollment.programmeCode,
      name: enrollment.programmeName,
    },
    student: {
      legalName: [enrollment.given, enrollment.middle, enrollment.family]
        .filter((x): x is string => x !== null && x !== "")
        .join(" "),
      matricNumber: enrollment.matricNumber,
    },
    courses: rows.map((x) => ({
      code: x.code,
      title: x.title,
      completedOn: x.result.completedOn,
      creditsX10: x.result.creditsX10,
      finalPctX100: x.result.finalPctX100,
      letter: x.result.letter,
      pointsX100: x.result.pointsX100,
      resultKind: x.result.resultKind as ResultKind,
      attemptNo: x.result.attemptNo,
      repeated: (latestAttempt.get(x.result.courseId) ?? 0) > x.result.attemptNo,
      imported: x.result.source === "IMPORT",
      provisional: x.result.status !== "APPROVED",
    })),
    totals: {
      creditsAttemptedX10: total.creditsAttemptedX10,
      creditsEarnedX10: total.creditsEarnedX10,
      cgpaX100: total.cgpaX100,
      standing: total.standing,
    },
    awards: awards.flatMap((x) =>
      x.awardClass !== null && x.certificateNo !== null && x.awardedOn !== null
        ? [
            {
              awardType: x.awardType as TranscriptSnapshot["awards"][number]["awardType"],
              awardClass: x.awardClass,
              certificateNo: x.certificateNo,
              awardedOn: x.awardedOn,
            },
          ]
        : [],
    ),
    legend: {
      bands: rules.bands,
      classBands: rules.classBands,
      minAwardCgpaX100: rules.minAwardCgpaX100,
      repeatPolicy: rules.repeatPolicy,
    },
  });
}
