import { fileURLToPath } from "node:url";
import type { TranscriptSnapshot } from "@glim/contracts";
import {
  Document,
  Font,
  Image,
  Page,
  renderToBuffer,
  StyleSheet,
  Text as PdfText,
  View,
  type TextProps,
} from "@react-pdf/renderer";
import QRCode from "qrcode";
import {
  createElement as h,
  type ComponentType,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from "react";
import type { TranscriptRenderInput, TranscriptRenderer } from "./port";

const FAMILY = "Noto Sans";
let fontsRegistered = false;

/** Noto Sans (SIL OFL) is embedded: it carries Yoruba and Igbo tonal marks (ẹ́, ọ̀, ṣ, ń, ụ). */
function registerFonts(): void {
  if (fontsRegistered) return;
  Font.register({
    family: FAMILY,
    fonts: [
      { src: fileURLToPath(new URL("./fonts/NotoSans-Regular.ttf", import.meta.url)) },
      {
        src: fileURLToPath(new URL("./fonts/NotoSans-Bold.ttf", import.meta.url)),
        fontWeight: 700,
      },
    ],
  });
  // Keep words whole: names and course titles must not be hyphenated.
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: FAMILY,
    fontSize: 9,
    paddingTop: 72,
    paddingBottom: 60,
    paddingHorizontal: 40,
  },
  header: {
    position: "absolute",
    top: 24,
    left: 40,
    right: 40,
    borderBottomWidth: 1,
    borderBottomColor: "#999",
    paddingBottom: 6,
  },
  institution: { fontSize: 13, fontWeight: 700 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#555",
    borderTopWidth: 1,
    borderTopColor: "#999",
    paddingTop: 4,
  },
  // A4 is 595 × 842 pt: a full-width box through the middle, turned. Explicit sizes keep the
  // rotated word from wrapping.
  watermark: {
    position: "absolute",
    top: 371,
    left: 0,
    width: 595,
    height: 100,
    justifyContent: "center",
    transform: "rotate(-35deg)",
  },
  watermarkText: {
    textAlign: "center",
    fontSize: 60,
    color: "#d33",
    opacity: 0.15,
  },
  h2: { fontSize: 10, fontWeight: 700, marginTop: 10, marginBottom: 3 },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
    paddingVertical: 2,
  },
  head: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#999",
    paddingVertical: 2,
    fontWeight: 700,
  },
  code: { width: "14%" },
  title: { width: "50%" },
  num: { width: "12%", textAlign: "right" },
  small: { fontSize: 8, color: "#444" },
  provisional: { color: "#a60", fontWeight: 700 },
  verify: { flexDirection: "row", marginTop: 14, alignItems: "center" },
  qr: { width: 72, height: 72, marginRight: 10 },
});

/** Hundredths as a decimal with two places, without floats. */
const x100 = (v: number | null) =>
  v === null ? "–" : `${String(Math.trunc(v / 100))}.${String(v % 100).padStart(2, "0")}`;
/** Tenths of a credit. */
const x10 = (v: number) =>
  v % 10 === 0 ? String(v / 10) : `${String(Math.trunc(v / 10))}.${String(v % 10)}`;

/** react-pdf's Text, without its SVG overload. */
const Text = PdfText as unknown as ComponentType<PropsWithChildren<TextProps>>;
type TextStyle = TextProps["style"];

const text = (style: TextStyle, ...children: ReactNode[]) =>
  h(Text, style === undefined ? {} : { style }, ...children);

/** The courses in the order completed (ADR-0005); the header row repeats on each page. */
function courses(list: TranscriptSnapshot["courses"]): ReactElement {
  return h(
    View,
    {},
    text(styles.h2, "Courses"),
    h(
      View,
      { style: styles.head, fixed: true },
      text(styles.code, "Course"),
      text(styles.title, "Title"),
      text(styles.num, "Completed"),
      text(styles.num, "Credits"),
      text(styles.num, "%"),
      text(styles.num, "Grade"),
    ),
    ...list.map((c, i) =>
      h(
        View,
        { key: i, style: styles.row, wrap: false },
        text(styles.code, c.code),
        text(
          styles.title,
          `${c.title}${c.repeated ? " (repeated)" : ""}`,
          c.provisional ? text(styles.provisional, "  PROVISIONAL") : "",
        ),
        text(styles.num, c.completedOn),
        text(styles.num, x10(c.creditsX10)),
        text(styles.num, x100(c.finalPctX100)),
        text(styles.num, c.letter ?? c.resultKind.toLowerCase()),
      ),
    ),
  );
}

/**
 * The transcript, drawn only from the snapshot (§14.7): A4, a header and footer on every page
 * with "page n of N", the serial and a short hash; a QR code to the verify page; and a watermark
 * on unofficial copies.
 */
export function transcriptDocument(input: TranscriptRenderInput, qrDataUrl: string): ReactElement {
  const s = input.snapshot;
  const official = s.kind === "OFFICIAL";
  return h(
    Document,
    {
      title: `Transcript ${input.serialNo}`,
      author: s.institution.name,
      creator: s.institution.name,
    },
    h(
      Page,
      { size: "A4", style: styles.page },
      h(
        View,
        { style: styles.header, fixed: true },
        text(styles.institution, s.institution.name),
        text(undefined, `${official ? "Official" : "Unofficial"} transcript · ${input.serialNo}`),
      ),
      official
        ? null
        : h(
            View,
            { style: styles.watermark, fixed: true },
            text(styles.watermarkText, "UNOFFICIAL"),
          ),
      text({ fontSize: 11, fontWeight: 700 }, s.student.legalName),
      text(undefined, `Matric Number ${s.student.matricNumber}`),
      text(undefined, `${s.programme.name} (${s.programme.code})`),
      text(styles.small, `Records as of ${s.asOf}`),
      courses(s.courses),
      h(
        View,
        { wrap: false },
        text(styles.h2, "Summary"),
        text(
          undefined,
          `CGPA ${x100(s.totals.cgpaX100)} · credits earned ${x10(s.totals.creditsEarnedX10)} of ${x10(s.totals.creditsAttemptedX10)}`,
        ),
        ...s.awards.map((a, i) =>
          h(
            Text,
            { key: i },
            `Awarded ${a.awardType === "CERTIFICATE" ? "the Certificate" : "the Diploma"} with ${a.awardClass} on ${a.awardedOn} (${a.certificateNo})`,
          ),
        ),
        text(
          styles.small,
          `Grades: ${s.legend.bands.map((b) => `${b.letter} ${x100(b.minX100)}–${x100(b.maxX100)} = ${x100(b.pointsX100)}`).join("; ")}`,
        ),
        text(
          styles.small,
          `Award classes (final CGPA): ${s.legend.classBands.map((c) => `${c.label} ${x100(c.minCgpaX100)}–${x100(c.maxCgpaX100)}`).join("; ")}; no award below ${x100(s.legend.minAwardCgpaX100)}.`,
        ),
      ),
      h(
        View,
        { style: styles.verify, wrap: false },
        h(Image, { src: qrDataUrl, style: styles.qr }),
        h(
          View,
          {},
          text(undefined, "Check this transcript at"),
          text({ fontWeight: 700 }, input.verifyUrl),
          text(styles.small, `Verification code ${input.verificationCode}`),
          text(styles.small, `SHA-256 ${input.snapshotSha256}`),
        ),
      ),
      h(
        View,
        { style: styles.footer, fixed: true },
        text(undefined, `${input.serialNo} · ${input.snapshotSha256.slice(0, 16)}`),
        h(Text, {
          render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
            `Page ${String(pageNumber)} of ${String(totalPages)}`,
        }),
      ),
    ),
  );
}

/** @react-pdf/renderer with the embedded Noto Sans fonts. */
export class ReactPdfTranscriptRenderer implements TranscriptRenderer {
  async render(input: TranscriptRenderInput): Promise<Uint8Array> {
    registerFonts();
    const qr = await QRCode.toDataURL(input.verifyUrl, { margin: 0, width: 256 });
    const buffer = await renderToBuffer(transcriptDocument(input, qr) as never);
    return new Uint8Array(buffer);
  }
}
