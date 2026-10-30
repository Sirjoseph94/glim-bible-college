import { cumulativeGpa, type RepeatPolicy, type ResultLine } from "./grading";

/** A curriculum course with the credits it counts for, in tenths. */
export interface CurriculumCourse {
  courseId: string;
  creditsX10: number;
}

export interface AwardEligibility {
  totalCreditsX10: number;
  /** Credits of curriculum courses passed (or exempted), each course once. */
  passedCreditsX10: number;
  /** Half the curriculum's credits or more passed. */
  certificate: boolean;
  /** Every curriculum course passed. */
  diploma: boolean;
}

/**
 * What a student has earned towards the awards (ADR-0005): the Certificate once the curriculum
 * courses they've passed carry at least half its credits, the Diploma once they've passed every
 * course. A course counts as passed when the attempt the repeat policy keeps passed, or it was
 * exempted; results for courses outside the curriculum don't count. Integers only (INV-14).
 */
export function awardEligibility(
  curriculum: CurriculumCourse[],
  results: ResultLine[],
  policy: RepeatPolicy,
): AwardEligibility {
  const inCurriculum = new Set(curriculum.map((c) => c.courseId));
  const passed = passedCourses(curriculum, results, policy);
  const totalCreditsX10 = curriculum.reduce((sum, c) => sum + c.creditsX10, 0);
  const passedCreditsX10 = curriculum
    .filter((c) => passed.has(c.courseId))
    .reduce((sum, c) => sum + c.creditsX10, 0);
  return {
    totalCreditsX10,
    passedCreditsX10,
    certificate: totalCreditsX10 > 0 && passedCreditsX10 * 2 >= totalCreditsX10,
    diploma: curriculum.length > 0 && passed.size === inCurriculum.size,
  };
}

/**
 * The curriculum courses passed: the attempt the repeat policy keeps passed, or the course was
 * exempted.
 */
export function passedCourses(
  curriculum: CurriculumCourse[],
  results: ResultLine[],
  policy: RepeatPolicy,
): Set<string> {
  const passed = new Set<string>();
  for (const { courseId } of curriculum) {
    const attempts = results.filter((r) => r.courseId === courseId);
    if (attempts.some((r) => r.resultKind === "EXEMPT")) passed.add(courseId);
    else if (cumulativeGpa(attempts, policy).creditsEarnedX10 > 0) passed.add(courseId);
  }
  return passed;
}

/** A result's approval state as the Provisional label needs it. */
export interface ApprovalState {
  status: string;
  resultKind: string;
  countsInGpa: boolean;
}

/**
 * Whether a CGPA is Provisional (§14.5, ADR-0005): until the Registrar has approved every result
 * it counts. With nothing counted yet there's nothing final either.
 */
export function isProvisional(results: ApprovalState[]): boolean {
  const counted = results.filter((r) => r.resultKind === "GRADED" && r.countsInGpa);
  return counted.length === 0 || counted.some((r) => r.status !== "APPROVED");
}
