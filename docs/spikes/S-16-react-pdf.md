# Spike S-16: @react-pdf/renderer for transcripts

**Status:** done, 2026-10-09 (ticket 42). **Outcome:** keep `@react-pdf/renderer` 4.9.0 with embedded Noto Sans; two quirks worked around (below).
**Why:** transcripts are rendered as PDFs from their snapshot (TRD §14.7). The renderer must draw Nigerian names correctly, paginate a full programme and be fast enough to run in a job.

The check is automated in `packages/integrations/src/pdf/react-pdf.test.ts`. It renders a 4-semester, 32-course transcript whose student name and course titles carry Yoruba and Igbo tonal marks ("Adébáyọ̀ Ọláolúwa Ńnàmdí Ụ̀gọ́chukwu", "Ìjọ́sìn àti Ẹ̀kọ́ Bíbélì — Ọlọ́run"). Set `VITE_S16_OUT=<dir>` to keep the PDFs for a visual check.

| Check | Expected | Observed (MacBook, Node 24) |
|---|---|---|
| Glyphs: precomposed and combining tonal marks (ẹ́, ọ̀, ṣ, ń, ụ̀) | Drawn correctly | Correct with Noto Sans (SIL OFL), embedded and subset |
| Pagination | Header and footer on every page, "Page n of N" | 2 A4 pages; header, footer, serial and short hash on each; semesters never split across a page |
| Render time | < 3 s | 70–80 ms after the fonts load (first render about 1 s) |
| QR code | Links to `/verify/<code>` | Drawn from `qrcode` as a PNG data URL |
| Unofficial watermark | Visible on every page | Drawn, after the fix below |

**Quirks found:**
1. **Watermark first letter dropped.** A large **bold** "UNOFFICIAL" lost its first glyph when it was the only use of that bold glyph in the document. The text layer showed "NOFFICIAL" too, so the problem is in how react-pdf subsets the font, not in drawing it. Drawing the watermark in the regular weight fixes it. If a bold heading ever renders with a missing letter, suspect the same thing.
2. **Copy-and-paste text is unreliable.** Text copied out of the PDF comes out scrambled for the subset fonts (missing or wrong character mappings). The printed page is correct, which is what a transcript needs, and integrity rests on `snapshot_sha256` and the verify page, not on the PDF's text. Revisit if search inside PDFs becomes a requirement.

**Fallback (not needed):** switch the adapter behind `TranscriptRenderer` (`packages/integrations/src/pdf/port.ts`) to pdfkit directly.
