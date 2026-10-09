import { schema, type Database } from "@glim/db";
import { domainError, err, ok, parseDecimal, type DomainResult } from "@glim/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
import { courseOutcome, type ResultKind } from "./domain/grading";
import { rulesOf } from "./grading-schemes.service";

export interface ImportedResult {
  programmeEnrollmentId: string;
  semesterId: string;
  courseId: string;
  /** Null: the curriculum's credits for the course, else the course's. */
  creditsX10: number | null;
  /** Required for GRADED; ignored otherwise. */
  finalPctX100: number | null;
  resultKind: Exclude<ResultKind, "AUDIT">;
}

const problem = (message: string) => err(domainError("VALIDATION_FAILED", message));

/**
 * Records a past course result for an existing student (D-04, §15.2) inside the import's
 * transaction: graded with the programme's scheme (rounding to a whole percent before banding,
 * the default), APPROVED straight away so it counts toward CGPA, and identified by programme
 * enrollment, semester and course so importing it again updates it.
 */
export async function recordImportedResult(
  db: Database,
  input: ImportedResult,
  now: Date,
): Promise<DomainResult<"created" | "updated" | "unchanged">> {
  const pe = schema.programmeEnrollments;
  const [enrollment] = await db
    .select({
      studentId: pe.studentId,
      curriculumId: pe.curriculumId,
      schemeId: schema.programmes.gradingSchemeId,
      programmeCode: schema.programmes.code,
    })
    .from(pe)
    .innerJoin(schema.programmes, eq(schema.programmes.id, pe.programmeId))
    .where(eq(pe.id, input.programmeEnrollmentId));
  if (enrollment === undefined) return problem("No such programme enrollment");
  if (enrollment.schemeId === null)
    return problem(`Programme ${enrollment.programmeCode} has no grading scheme yet`);
  const [scheme] = await db
    .select()
    .from(schema.gradingSchemes)
    .where(eq(schema.gradingSchemes.id, enrollment.schemeId));
  if (scheme === undefined) return problem("The programme's grading scheme is missing");

  let creditsX10 = input.creditsX10;
  if (creditsX10 === null) {
    const [placed] = await db
      .select({ override: schema.curriculumCourses.creditOverride })
      .from(schema.curriculumCourses)
      .where(
        and(
          eq(schema.curriculumCourses.curriculumId, enrollment.curriculumId),
          eq(schema.curriculumCourses.courseId, input.courseId),
        ),
      );
    const [course] = await db
      .select({ credits: schema.courses.credits })
      .from(schema.courses)
      .where(eq(schema.courses.id, input.courseId));
    creditsX10 = parseDecimal(placed?.override ?? course?.credits ?? "0", 1);
  }

  const graded = input.resultKind === "GRADED";
  if (graded && input.finalPctX100 === null) return problem("A graded result needs a percent");
  const outcome =
    graded && input.finalPctX100 !== null
      ? courseOutcome(rulesOf(scheme), input.finalPctX100, creditsX10, "INTEGER")
      : null;

  const r = schema.courseResults;
  const clash = await db
    .select({ id: r.id })
    .from(r)
    .where(
      and(
        eq(r.programmeEnrollmentId, input.programmeEnrollmentId),
        eq(r.semesterId, input.semesterId),
        eq(r.courseId, input.courseId),
        ne(r.source, "IMPORT"),
      ),
    );
  if (clash.length > 0)
    return problem("The student already has a result for this course from the gradebook");

  // Attempts in earlier semesters come first.
  const s = schema.semesters;
  const ses = schema.academicSessions;
  const [here] = await db
    .select({ startsOn: ses.startsOn, sequence: s.sequence })
    .from(s)
    .innerJoin(ses, eq(ses.id, s.academicSessionId))
    .where(eq(s.id, input.semesterId));
  const others = await db
    .select({ id: r.id, startsOn: ses.startsOn, sequence: s.sequence, semesterId: r.semesterId })
    .from(r)
    .innerJoin(s, eq(s.id, r.semesterId))
    .innerJoin(ses, eq(ses.id, s.academicSessionId))
    .where(and(eq(r.studentId, enrollment.studentId), eq(r.courseId, input.courseId)));
  const earlier = others.filter(
    (o) =>
      here !== undefined &&
      (o.startsOn < here.startsOn || (o.startsOn === here.startsOn && o.sequence < here.sequence)),
  ).length;

  const fields = {
    programmeEnrollmentId: input.programmeEnrollmentId,
    semesterId: input.semesterId,
    courseId: input.courseId,
    studentId: enrollment.studentId,
    gradingSchemeId: scheme.id,
    source: "IMPORT",
    attemptNo: earlier + 1,
    creditsX10,
    finalPctX100: graded ? input.finalPctX100 : null,
    letter: outcome?.letter ?? null,
    pointsX100: outcome?.pointsX100 ?? null,
    qualityPointsX1000: outcome?.qualityPointsX1000 ?? null,
    resultKind: input.resultKind,
    countsInGpa: graded,
    passed: outcome?.passed ?? null,
  };
  const [existing] = await db
    .select()
    .from(r)
    .where(
      and(
        eq(r.programmeEnrollmentId, input.programmeEnrollmentId),
        eq(r.semesterId, input.semesterId),
        eq(r.courseId, input.courseId),
        eq(r.source, "IMPORT"),
      ),
    );
  await db
    .update(schema.gradingSchemes)
    .set({ lockedAt: now })
    .where(and(eq(schema.gradingSchemes.id, scheme.id), isNull(schema.gradingSchemes.lockedAt)));
  if (existing === undefined) {
    await db.insert(r).values({
      ...fields,
      status: "APPROVED",
      finalizedAt: now,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return ok("created");
  }
  const same = (Object.keys(fields) as (keyof typeof fields)[]).every(
    (k) => existing[k] === fields[k],
  );
  if (same) return ok("unchanged");
  await db
    .update(r)
    .set({ ...fields, updatedAt: now, version: existing.version + 1 })
    .where(eq(r.id, existing.id));
  return ok("updated");
}
