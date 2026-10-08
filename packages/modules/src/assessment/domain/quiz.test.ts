import type { QuizResponseValue, SnapshotQuestion } from "@glim/db";
import { describe, expect, it } from "vitest";
import {
  combineAttempts,
  deadlineFor,
  markResponse,
  normaliseAnswer,
  scaleToMax,
  shuffled,
} from "./quiz";

const q = (over: Partial<SnapshotQuestion>): SnapshotQuestion => ({
  questionId: "q",
  qtype: "MCQ_SINGLE",
  promptMd: "?",
  options: [],
  pointsX100: 200,
  explanationMd: null,
  ...over,
});

const opts = (correct: string[]) =>
  ["a", "b", "c"].map((id) => ({ id, text: id.toUpperCase(), correct: correct.includes(id) }));

describe("markResponse", () => {
  it.each([
    ["single, right", q({ options: opts(["b"]) }), { optionIds: ["b"] }, true, 200],
    ["single, wrong", q({ options: opts(["b"]) }), { optionIds: ["a"] }, false, 0],
    ["single, two chosen", q({ options: opts(["b"]) }), { optionIds: ["a", "b"] }, false, 0],
    [
      "multi, exact set",
      q({ qtype: "MCQ_MULTI", options: opts(["a", "c"]) }),
      { optionIds: ["c", "a"] },
      true,
      200,
    ],
    [
      "multi, partial is wrong",
      q({ qtype: "MCQ_MULTI", options: opts(["a", "c"]) }),
      { optionIds: ["a"] },
      false,
      0,
    ],
    [
      "true/false",
      q({
        qtype: "TRUE_FALSE",
        options: [
          { id: "true", text: "True", correct: true },
          { id: "false", text: "False", correct: false },
        ],
      }),
      { optionIds: ["true"] },
      true,
      200,
    ],
    ["no response", q({ options: opts(["b"]) }), null, false, 0],
    [
      "short text, loose match",
      q({ qtype: "SHORT_TEXT", options: [{ id: "1", text: "The  Word", correct: true }] }),
      { text: "  the word " },
      true,
      200,
    ],
    [
      "short text, any accepted answer",
      q({
        qtype: "SHORT_TEXT",
        options: [
          { id: "1", text: "Logos", correct: true },
          { id: "2", text: "Word", correct: true },
        ],
      }),
      { text: "logos" },
      true,
      200,
    ],
    [
      "short text, wrong",
      q({ qtype: "SHORT_TEXT", options: [{ id: "1", text: "Word", correct: true }] }),
      { text: "Light" },
      false,
      0,
    ],
    [
      "short text, empty",
      q({ qtype: "SHORT_TEXT", options: [{ id: "1", text: "Word", correct: true }] }),
      { text: "  " },
      false,
      0,
    ],
  ] as const)("%s", (_why, question, response, isCorrect, points) => {
    expect(markResponse(question, response as QuizResponseValue | null)).toEqual({
      isCorrect,
      pointsX100: points,
    });
  });

  it("leaves essays for a person", () => {
    expect(markResponse(q({ qtype: "ESSAY" }), { text: "Long answer" })).toEqual({
      isCorrect: null,
      pointsX100: null,
    });
  });
});

describe("combineAttempts", () => {
  it.each([
    ["HIGHEST", [1000, 1550, 1200], 1550],
    ["LAST", [1000, 1550, 1200], 1200],
    ["AVERAGE", [1000, 1550, 1200], 1250],
    ["AVERAGE", [1000, 1001], 1001],
    ["AVERAGE", [1, 1, 2], 1],
    ["HIGHEST", [], null],
  ] as const)("%s of %j is %s", (scoring, scores, expected) => {
    expect(combineAttempts(scoring, [...scores])).toBe(expected);
  });
});

describe("deadlineFor", () => {
  const start = new Date("2026-11-02T09:00:00Z");
  it("takes the time limit, cut short by the close", () => {
    expect(deadlineFor(start, 30, null)).toEqual(new Date("2026-11-02T09:30:00Z"));
    expect(deadlineFor(start, 30, new Date("2026-11-02T09:10:00Z"))).toEqual(
      new Date("2026-11-02T09:10:00Z"),
    );
    expect(deadlineFor(start, null, new Date("2026-11-03T00:00:00Z"))).toEqual(
      new Date("2026-11-03T00:00:00Z"),
    );
    expect(deadlineFor(start, null, null)).toBeNull();
  });
});

describe("helpers", () => {
  it("normalises answers", () => {
    expect(normaliseAnswer("  In The\\tBeginning ")).toBe("in the\\tbeginning");
    expect(normaliseAnswer(" In   The Beginning ")).toBe("in the beginning");
  });

  it("shuffles without losing anything", () => {
    const out = shuffled([1, 2, 3, 4, 5], () => 0);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(out).not.toEqual([1, 2, 3, 4, 5]);
  });
});

describe("scaleToMax", () => {
  it.each([
    // Appendix C.2: 33/50 quiz points on an exam out of 100 is 66.00, as on paper.
    ["C.2 online exam", 3300, 5000, 10_000, 6600],
    ["same scale", 1234, 2000, 2000, 1234],
    ["full marks", 5000, 5000, 10_000, 10_000],
    ["zero", 0, 5000, 10_000, 0],
    // 1/3 of 100 = 33.333… → 33.33; 2/3 = 66.666… → 66.67 (half-up in hundredths).
    ["thirds down", 100, 300, 10_000, 3333],
    ["thirds up", 200, 300, 10_000, 6667],
    ["exact half rounds up", 1, 2, 1, 1],
  ])("%s", (_, score, total, max, expected) => {
    expect(scaleToMax(score, total, max)).toBe(expected);
  });

  it("refuses a quiz with no points", () => {
    expect(() => scaleToMax(0, 0, 100)).toThrow();
  });
});
