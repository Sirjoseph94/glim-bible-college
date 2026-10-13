import type { QuizAttempt } from "@glim/contracts";
import type { QueuedStep, QueuedWork } from "../offline/queue";

/** A student's answer to one question; null when cleared. */
export type Response = QuizAttempt["questions"][number]["response"];
/** Answers by question id. */
export type Answers = Record<string, Response>;

interface SaveBody {
  seq: number;
  responses: { questionId: string; response: Response }[];
}

/** The offline-queue group for an attempt's answers (its "waiting to send" pill). */
export const quizGroup = (attemptId: string) => `quiz:${attemptId}`;

/**
 * One autosave as the queue sends it: the batch's answers with its `seq`. The server ignores a
 * `seq` not above the last it stored, so batches only ever land in the order they were made.
 */
export function saveStep(attemptId: string, seq: number, answers: Answers): QueuedStep {
  const body: SaveBody = {
    seq,
    responses: Object.entries(answers).map(([questionId, response]) => ({ questionId, response })),
  };
  return { method: "PATCH", path: "/quiz-attempts/:id", params: { id: attemptId }, body };
}

const saves = (items: QueuedWork[]) =>
  items.flatMap((work) => work.steps.map((step) => step.body as SaveBody));

/** The answers in queued saves, oldest first, so the latest answer to a question wins. */
export function queuedAnswers(items: QueuedWork[]): Answers {
  const answers: Answers = {};
  for (const save of saves(items))
    for (const { questionId, response } of save.responses) answers[questionId] = response;
  return answers;
}

/** The highest `seq` among queued saves, and at least `floor` (the server's last). */
export function latestSeq(items: QueuedWork[], floor: number): number {
  return saves(items).reduce((max, save) => Math.max(max, save.seq), floor);
}

/** The next save's `seq`: the clock, but always above the last one. */
export function nextSeq(last: number, now: number): number {
  return Math.max(now, last + 1);
}

/** Answers changed again (or added) after `batch` was taken from them. */
export function changedSince(current: Answers, batch: Answers): Answers {
  return Object.fromEntries(
    Object.entries(current).filter(
      ([questionId, response]) => !(questionId in batch) || batch[questionId] !== response,
    ),
  );
}

/**
 * The answers to show once the queue has been read: those still waiting on the phone over the
 * server's copy, except questions the student has answered again since the page opened.
 */
export function restoreAnswers(
  shown: Answers,
  waiting: Answers,
  editedSince: Set<string>,
): Answers {
  const restored = { ...shown };
  for (const [questionId, response] of Object.entries(waiting))
    if (!editedSince.has(questionId)) restored[questionId] = response;
  return restored;
}

/** How many questions have answers not yet stored on the server: queued or not yet batched. */
export function waitingCount(items: QueuedWork[], unbatched: Answers): number {
  return new Set([...Object.keys(queuedAnswers(items)), ...Object.keys(unbatched)]).size;
}

/**
 * Folds a newer queued save into an older one that hasn't started sending (offline/queue.ts
 * `Merge`): the newer answer to each question and the newer `seq`, so a burst of offline
 * answers goes back as one request within the deadline's grace.
 */
export function mergeSaves(older: QueuedWork, newer: QueuedWork): QueuedWork {
  const answers = queuedAnswers([older, newer]);
  const seq = latestSeq([older, newer], 0);
  const attemptId = newer.steps[0]?.params?.id ?? older.steps[0]?.params?.id;
  if (attemptId === undefined) throw new Error("A quiz save names its attempt.");
  return { ...older, steps: [saveStep(attemptId, seq, answers)] };
}
