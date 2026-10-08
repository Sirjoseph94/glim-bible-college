import { schema, type Database } from "@glim/db";
import { parseDecimal } from "@glim/shared";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { combineAttempts, scaleToMax } from "./domain/quiz";

type QuizRow = typeof schema.quizzes.$inferSelect;

/**
 * Whether a student may take this quiz online (C-34). Quizzes are for everyone; an online exam
 * (`eligible_study_mode = 'ONLINE'`) is for students whose Study Mode on this course is Online,
 * and for On-campus students the Lecturer has let in.
 */
export async function onlineEligible(
  db: Database,
  quiz: QuizRow,
  studentId: string,
): Promise<boolean> {
  if (quiz.eligibleStudyMode !== "ONLINE") return true;
  const ce = schema.courseEnrollments;
  const pe = schema.programmeEnrollments;
  const [mode] = await db
    .select({ studyMode: pe.studyMode })
    .from(ce)
    .innerJoin(pe, eq(pe.id, ce.programmeEnrollmentId))
    .where(and(eq(ce.courseOfferingId, quiz.courseOfferingId), eq(ce.studentId, studentId)))
    .limit(1);
  if (mode?.studyMode === "ONLINE") return true;
  const g = schema.examOnlineGrants;
  const [grant] = await db
    .select({ id: g.id })
    .from(g)
    .where(and(eq(g.quizId, quiz.id), eq(g.studentId, studentId)));
  return grant !== undefined;
}

/**
 * The student's score from their scored attempts, combined per the quiz's attempt scoring and,
 * for an online exam, scaled from the questions' total to the exam's maximum. In hundredths;
 * null if no attempt has a score yet.
 */
export async function attemptsScore(
  db: Database,
  quiz: QuizRow,
  studentId: string,
): Promise<number | null> {
  const a = schema.quizAttempts;
  const scored = await db
    .select({ score: a.score, snapshot: a.questionSnapshot })
    .from(a)
    .where(and(eq(a.quizId, quiz.id), eq(a.studentId, studentId), isNotNull(a.score)))
    .orderBy(asc(a.attemptNo));
  const combined = combineAttempts(
    quiz.attemptScoring as "HIGHEST" | "LAST" | "AVERAGE",
    scored.map((s) => parseDecimal(s.score ?? "0", 2)),
  );
  if (combined === null) return null;
  const [column] = await db
    .select({ kind: schema.assessments.kind, maxScore: schema.assessments.maxScore })
    .from(schema.assessments)
    .where(eq(schema.assessments.id, quiz.assessmentId));
  if (column?.kind !== "EXAM") return combined;
  // A published quiz's questions never change, so every attempt has the same total.
  const total = (scored[0]?.snapshot ?? []).reduce((sum, q) => sum + q.pointsX100, 0);
  return scaleToMax(combined, total, parseDecimal(column.maxScore, 2));
}
