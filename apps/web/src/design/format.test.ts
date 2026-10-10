import { describe, expect, it } from "vitest";
import { credits, dueState, fileSize, hundredths, wordCount } from "./format";

describe("fileSize (handoff §10.6)", () => {
  it("reads as KB under a megabyte and MB with one decimal above", () => {
    expect(fileSize(310 * 1024)).toBe("310 KB");
    expect(fileSize(1.2 * 1024 * 1024)).toBe("1.2 MB");
    expect(fileSize(512)).toBe("1 KB");
    expect(fileSize(50 * 1024 * 1024)).toBe("50 MB");
  });
});

describe("wordCount", () => {
  it("counts words in any script, ignoring extra spaces", () => {
    expect(wordCount("In the beginning  was the Word.")).toBe(6);
    expect(wordCount("  ")).toBe(0);
    expect(wordCount("Ọlọ́run ni ìfẹ́")).toBe(3);
  });
});

describe("dueState (handoff §11.5)", () => {
  const due = "2026-10-13T16:00:00Z";
  const at = (iso: string) => new Date(iso);
  it("is due soon within 72 hours, overdue after, and late-allowed until it closes", () => {
    expect(dueState(due, null, at("2026-10-09T16:00:00Z"))).toBe("open");
    expect(dueState(due, null, at("2026-10-11T16:00:00Z"))).toBe("soon");
    expect(dueState(due, "2026-10-15T16:00:00Z", at("2026-10-14T00:00:00Z"))).toBe("late");
    expect(dueState(due, null, at("2026-10-14T00:00:00Z"))).toBe("closed");
    expect(dueState(due, "2026-10-15T16:00:00Z", at("2026-10-16T00:00:00Z"))).toBe("closed");
  });
});

describe("hundredths and credits (exact integers, no floats)", () => {
  it("shows GPA and percentages with two decimals, and a dash when there is none", () => {
    expect(hundredths(420)).toBe("4.20");
    expect(hundredths(500)).toBe("5.00");
    expect(hundredths(7)).toBe("0.07");
    expect(hundredths(8350)).toBe("83.50");
    expect(hundredths(null)).toBe("—");
  });

  it("shows credits from tenths without a needless decimal", () => {
    expect(credits(30)).toBe("3");
    expect(credits(25)).toBe("2.5");
  });
});
