import type { QuizResponseValue, SnapshotQuestion } from "@glim/db";
import { divRoundHalfUp, mulDivRoundHalfUp } from "@glim/shared";

/** The grace after a deadline for a save that was on its way, and when `quiz.expire` runs. */
export const QUIZ_GRACE_MS = 30_000;

/** Short-text answers match ignoring case, surrounding spaces and repeated spaces. */
export function normaliseAnswer(text: string): string {
  return text.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase("en");
}

export interface Mark {
  /** null for an essay, which is marked by hand. */
  isCorrect: boolean | null;
  /** In hundredths; null for an essay. */
  pointsX100: number | null;
}

/**
 * Marks one response (TRD §14.2): MCQ and true/false all-or-nothing on the exact set of correct
 * options, short text against the accepted answers. No response scores 0.
 */
export function markResponse(question: SnapshotQuestion, response: QuizResponseValue | null): Mark {
  if (question.qtype === "ESSAY") return { isCorrect: null, pointsX100: null };
  let correct: boolean;
  if (question.qtype === "SHORT_TEXT") {
    const given = response !== null && "text" in response ? normaliseAnswer(response.text) : "";
    correct = given !== "" && question.options.some((o) => normaliseAnswer(o.text) === given);
  } else {
    const chosen = new Set(response !== null && "optionIds" in response ? response.optionIds : []);
    const right = new Set(question.options.filter((o) => o.correct).map((o) => o.id));
    correct = chosen.size === right.size && [...chosen].every((id) => right.has(id));
  }
  return { isCorrect: correct, pointsX100: correct ? question.pointsX100 : 0 };
}

/** The gradebook score from an attempt's scores (hundredths), per the quiz's attempt scoring. */
export function combineAttempts(
  scoring: "HIGHEST" | "LAST" | "AVERAGE",
  scoresInOrder: number[],
): number | null {
  if (scoresInOrder.length === 0) return null;
  if (scoring === "HIGHEST") return Math.max(...scoresInOrder);
  if (scoring === "LAST") return scoresInOrder[scoresInOrder.length - 1] ?? null;
  return divRoundHalfUp(
    scoresInOrder.reduce((a, b) => a + b, 0),
    scoresInOrder.length,
  );
}

/**
 * An online exam's score on the exam's scale (C-34, Appendix C.2): the quiz points scored, out of
 * the quiz's total, scaled to the exam's maximum and rounded half-up, all in hundredths. A quiz
 * whose total is the maximum is unchanged.
 */
export function scaleToMax(scoreX100: number, pointsTotalX100: number, maxX100: number): number {
  if (pointsTotalX100 <= 0) throw new Error("a quiz with no points can't be scaled");
  if (pointsTotalX100 === maxX100) return scoreX100;
  return mulDivRoundHalfUp(scoreX100, maxX100, pointsTotalX100);
}

/** When an attempt must end: the time limit from the start, cut short by the quiz closing. */
export function deadlineFor(
  startedAt: Date,
  timeLimitMinutes: number | null,
  closesAt: Date | null,
): Date | null {
  const byLimit =
    timeLimitMinutes === null ? null : new Date(startedAt.getTime() + timeLimitMinutes * 60_000);
  if (byLimit === null) return closesAt;
  if (closesAt === null) return byLimit;
  return byLimit < closesAt ? byLimit : closesAt;
}

/** Fisher–Yates with an injectable random source (tests pass a fixed one). */
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
