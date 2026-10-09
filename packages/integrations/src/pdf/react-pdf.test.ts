import { writeFile } from "node:fs/promises";
import type { TranscriptSnapshot } from "@glim/contracts";
import { describe, expect, it } from "vitest";
import { ReactPdfTranscriptRenderer } from "./react-pdf";

/** Spike S-16: Unicode names, 4-semester pagination and render time (< 3 s). */

const course = (code: string, title: string, letter: string, pct: number) => ({
  code,
  title,
  creditsX10: 30,
  finalPctX100: pct,
  letter,
  pointsX100: 400,
  resultKind: "GRADED" as const,
  attemptNo: 1,
  repeated: false,
  imported: false,
});

function snapshot(kind: "OFFICIAL" | "UNOFFICIAL"): TranscriptSnapshot {
  const semesters = [1, 2, 3, 4].map((n) => ({
    sessionCode: n <= 2 ? "2025/2026" : "2026/2027",
    semesterName: n % 2 === 1 ? "First Semester" : "Second Semester",
    provisional: kind === "UNOFFICIAL" && n === 4,
    courses: Array.from({ length: 8 }, (_, i) =>
      course(
        `DIP${String(n)}0${String(i)}`,
        `Ìjọ́sìn àti Ẹ̀kọ́ Bíbélì ${String(i)} — Ọlọ́run`,
        "B",
        6500 + i,
      ),
    ),
    creditsAttemptedX10: 240,
    creditsEarnedX10: 240,
    gpaX100: 400,
    cgpaX100: 400,
    standing: "GOOD" as const,
  }));
  return {
    version: 1,
    kind,
    asOf: "2027-07-01",
    institution: { name: "GLIM Online Bible College" },
    programme: { code: "DIP", name: "Diploma in Ministry", awardType: "DIPLOMA" },
    student: { legalName: "Adébáyọ̀ Ọláolúwa Ńnàmdí Ụ̀gọ́chukwu", matricNumber: "GLIM/DIP/2025/0012" },
    semesters,
    totals: { creditsAttemptedX10: 960, creditsEarnedX10: 960, cgpaX100: 400, standing: "GOOD" },
    award:
      kind === "OFFICIAL"
        ? { awardClass: "Credit", certificateNo: "GLIM/DIP/AWD/2027/0001", awardedOn: "2027-07-01" }
        : null,
    legend: {
      bands: [
        { minX100: 7000, maxX100: 10000, letter: "A", pointsX100: 500, pass: true },
        { minX100: 0, maxX100: 3999, letter: "F", pointsX100: 0, pass: false },
      ],
      classBands: [{ minCgpaX100: 450, maxCgpaX100: 500, label: "Distinction" }],
      minAwardCgpaX100: 100,
      repeatPolicy: "BEST",
    },
  };
}

const input = (kind: "OFFICIAL" | "UNOFFICIAL") => ({
  snapshot: snapshot(kind),
  serialNo: "GLIM/TR/2027/00042",
  verificationCode: "ABCDEFGHIJKLMNOP",
  snapshotSha256: "0123456789abcdef".repeat(4),
  verifyUrl: "https://glim.example/verify/ABCDEFGHIJKLMNOP",
});

describe("ReactPdfTranscriptRenderer (S-16)", () => {
  it("renders a 4-semester transcript with tonal marks in under 3 s, fonts embedded, several pages", async () => {
    const renderer = new ReactPdfTranscriptRenderer();
    await renderer.render(input("OFFICIAL")); // warm-up: font loading
    const started = performance.now();
    const pdf = await renderer.render(input("OFFICIAL"));
    const ms = performance.now() - started;
    expect(ms).toBeLessThan(3000);
    const raw = Buffer.from(pdf).toString("latin1");
    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(raw).toMatch(/NotoSans/);
    expect(raw).toMatch(/FontFile2/);
    const pages = raw.match(/\/Type \/Page[^s]/g)?.length ?? 0;
    expect(pages).toBeGreaterThan(1);
    // Vitest fills import.meta.env from the environment: set VITE_S16_OUT=<dir> to keep the PDFs.
    const out = (import.meta as unknown as { env: Record<string, string | undefined> }).env
      .VITE_S16_OUT;
    if (out !== undefined) {
      await writeFile(`${out}/official.pdf`, pdf);
      await writeFile(`${out}/unofficial.pdf`, await renderer.render(input("UNOFFICIAL")));
      console.log(`S-16 render ${ms.toFixed(0)} ms, ${String(pages)} pages`);
    }
  }, 20_000);
});
