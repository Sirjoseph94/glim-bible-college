import { describe, expect, it } from "vitest";
import type { QueuedWork } from "../offline/queue";
import {
  changedSince,
  latestSeq,
  mergeSaves,
  nextSeq,
  queuedAnswers,
  quizGroup,
  restoreAnswers,
  saveStep,
  waitingCount,
  type Answers,
} from "./quiz-answers";

const Q1 = "11111111-1111-4111-8111-111111111111";
const Q2 = "22222222-2222-4222-8222-222222222222";
const Q3 = "33333333-3333-4333-8333-333333333333";

const save = (seq: number, answers: Answers): QueuedWork => ({
  key: `k-${String(seq)}`,
  group: quizGroup("a1"),
  steps: [saveStep("a1", seq, answers)],
});

describe("saveStep", () => {
  it("is the autosave PATCH with its seq and one response per question", () => {
    expect(saveStep("a1", 7, { [Q1]: { optionIds: ["b"] }, [Q2]: { text: "Grace" } })).toEqual({
      method: "PATCH",
      path: "/quiz-attempts/:id",
      params: { id: "a1" },
      body: {
        seq: 7,
        responses: [
          { questionId: Q1, response: { optionIds: ["b"] } },
          { questionId: Q2, response: { text: "Grace" } },
        ],
      },
    });
  });
});

describe("queuedAnswers", () => {
  it("is empty with nothing queued", () => {
    expect(queuedAnswers([])).toEqual({});
  });

  it("takes the last answer to each question, oldest batch first", () => {
    const items = [
      save(1, { [Q1]: { optionIds: ["a"] }, [Q2]: { text: "first" } }),
      save(2, { [Q2]: { text: "second" } }),
      save(3, { [Q1]: { optionIds: ["c"] } }),
    ];
    expect(queuedAnswers(items)).toEqual({
      [Q1]: { optionIds: ["c"] },
      [Q2]: { text: "second" },
    });
  });

  it("keeps a cleared answer (null) as an answer", () => {
    expect(
      queuedAnswers([save(1, { [Q1]: { optionIds: ["a"] } }), save(2, { [Q1]: null })]),
    ).toEqual({ [Q1]: null });
  });
});

describe("latestSeq", () => {
  it("is the highest seq among queued saves, or the floor given", () => {
    expect(latestSeq([], 5)).toBe(5);
    expect(latestSeq([save(9, {}), save(12, {}), save(10, {})], 5)).toBe(12);
    expect(latestSeq([save(3, {})], 5)).toBe(5);
  });
});

describe("nextSeq", () => {
  it("follows the clock, and always goes above the last one", () => {
    expect(nextSeq(100, 5_000)).toBe(5_000);
    expect(nextSeq(5_000, 5_000)).toBe(5_001);
    // A phone whose clock went backwards still sends a higher seq.
    expect(nextSeq(9_000, 5_000)).toBe(9_001);
  });
});

describe("changedSince", () => {
  it("keeps only answers changed again after the batch was taken", () => {
    const a = { optionIds: ["a"] };
    const b = { text: "batched" };
    const later = { text: "typed after" };
    expect(changedSince({ [Q1]: a, [Q2]: later, [Q3]: null }, { [Q1]: a, [Q2]: b })).toEqual({
      [Q2]: later,
      [Q3]: null,
    });
  });
});

describe("restoreAnswers", () => {
  it("puts answers still waiting on the phone over the server's, but not over new edits", () => {
    const shown: Answers = {
      [Q1]: { optionIds: ["a"] },
      [Q2]: { text: "edited here" },
      [Q3]: null,
    };
    const waiting: Answers = { [Q1]: { optionIds: ["b"] }, [Q2]: { text: "from before" } };
    expect(restoreAnswers(shown, waiting, new Set([Q2]))).toEqual({
      [Q1]: { optionIds: ["b"] },
      [Q2]: { text: "edited here" },
      [Q3]: null,
    });
  });
});

describe("waitingCount", () => {
  it("counts each question once, whether queued, not yet batched, or both", () => {
    expect(waitingCount([], {})).toBe(0);
    const items = [save(1, { [Q1]: null, [Q2]: { text: "x" } }), save(2, { [Q1]: null })];
    expect(waitingCount(items, { [Q2]: { text: "y" }, [Q3]: null })).toBe(3);
  });
});

describe("mergeSaves (a burst of offline answers goes back as one save)", () => {
  it("keeps the newer answer to each question and the newer seq", () => {
    const older = {
      key: "k1",
      group: quizGroup("a1"),
      steps: [saveStep("a1", 5, { q1: "A", q2: "B" } as unknown as Answers)],
    };
    const newer = {
      key: "k2",
      group: quizGroup("a1"),
      steps: [saveStep("a1", 9, { q2: "C", q3: "D" } as unknown as Answers)],
    };
    const merged = mergeSaves(older, newer);
    expect(merged.key).toBe("k1");
    expect(queuedAnswers([merged])).toEqual({ q1: "A", q2: "C", q3: "D" });
    expect(latestSeq([merged], 0)).toBe(9);
  });
});
