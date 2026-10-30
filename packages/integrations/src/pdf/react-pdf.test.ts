import { writeFile } from "node:fs/promises";
import type { TranscriptSnapshot } from "@glim/contracts";
import { describe, expect, it } from "vitest";
import { ReactPdfTranscriptRenderer } from "./react-pdf";

/** Spike S-16: Unicode names, several pages of courses and render time (< 3 s). */

const course = (
  code: string,
  title: string,
  letter: string,
  pct: number,
  completedOn: string,
  provisional: boolean,
) => ({
  code,
  title,
  completedOn,
  creditsX10: 30,
  finalPctX100: pct,
  letter,
  pointsX100: 400,
  resultKind: "GRADED" as const,
  attemptNo: 1,
  repeated: false,
  imported: false,
  provisional,
});

function snapshot(kind: "OFFICIAL" | "UNOFFICIAL"): TranscriptSnapshot {
  // 32 courses one after another, as four years of the old semesters held.
  const courses = Array.from({ length: 32 }, (_, i) =>
    course(
      `DIP${String(100 + i)}`,
      `Ìjọ́sìn àti Ẹ̀kọ́ Bíbélì ${String(i)} — Ọlọ́run`,
      "B",
      6500 + i,
      `2026-${String((i % 12) + 1).padStart(2, "0")}-28`,
      kind === "UNOFFICIAL" && i >= 24,
    ),
  );
  return {
    version: 2,
    kind,
    asOf: "2027-07-01",
    institution: { name: "GLIM Online Bible College" },
    programme: { code: "DIP", name: "Diploma in Ministry" },
    student: { legalName: "Adébáyọ̀ Ọláolúwa Ńnàmdí Ụ̀gọ́chukwu", matricNumber: "GLIM/DIP/2025/0012" },
    courses,
    totals: { creditsAttemptedX10: 960, creditsEarnedX10: 960, cgpaX100: 400, standing: "GOOD" },
    awards:
      kind === "OFFICIAL"
        ? [
            {
              awardType: "CERTIFICATE",
              awardClass: "Credit",
              certificateNo: "GLIM/CERT/AWD/2026/0001",
              awardedOn: "2026-07-01",
            },
            {
              awardType: "DIPLOMA",
              awardClass: "Credit",
              certificateNo: "GLIM/DIP/AWD/2027/0001",
              awardedOn: "2027-07-01",
            },
          ]
        : [],
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
  it("renders a 32-course transcript with tonal marks in under 3 s, fonts embedded, several pages", async () => {
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
