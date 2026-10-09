# 42: Transcript PDF, delivery, revoke and supersede

**What to build:** Issued transcripts render as A4 PDFs with a QR code and hash, students download them, the Registrar emails them to recipients, and revoked or superseded transcripts show that status when verified (TRD §14.7, AC-15).

**Blocked by:** 41 (Transcript requests, issue and public verification)

**Status:** done

- [x] `transcript.generate` renders from the snapshot only: header/footer every page, page n of N, embedded Unicode fonts (Yoruba/Igbo tonal marks test), QR to `/verify/<code>`, serial + short hash; unofficial watermark
- [x] Stored as a file in Spaces; student download authorized
- [x] Registrar emails the PDF (≤ 5 MB attachment or expiring link)
- [x] Revoke with a reason (audited); reopening a result marks affected transcripts SUPERSEDED; the verify page shows the status
- [x] Spike S-16 recorded

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-09).**
- **PDF:**
  - `packages/integrations/src/pdf/`: the port, the react-pdf adapter, and Noto Sans with its OFL licence.
  - Dependencies pinned: `@react-pdf/renderer` 4.9.0, `qrcode` 1.5.4, `react` 19.3.0.
  - Spike S-16 recorded in `docs/spikes/S-16-react-pdf.md`.
- **Mail:** attachments on the mail port.
- **Files:** server-only `TRANSCRIPT_PDF` purpose.
- **Transcripts service:** `generate` (job), `downloadUrl`, `send` and `sendNow` (job), `revoke`, `supersedeFor`; issuing queues `transcript.generate`.
- **Results:** reopening publishes `results.course.reopened`; the worker subscriber supersedes the transcripts that show the result.
- **API:** `GET /transcripts/:id/download`, `POST /transcripts/:id/send`, `POST /transcripts/:id/revoke`.
- **Web:** Download PDF; Email PDF and Revoke for the Registrar.
- **Tests:**
  - Unit (S-16): 4 semesters with tonal marks under 3 s, fonts embedded, more than one page.
  - `transcripts.itest.ts` (+4):
    - the PDF rendered by the job, then downloadable by its owner only, and rendering again doing nothing;
    - emailed as an attachment and audited;
    - reopening a result superseding every transcript that showed it (through the real event dispatcher), with verify showing SUPERSEDED;
    - revoking (Registrar only, not when superseded, reason, email notice, audit).
  - Authz samples for the three endpoints.
  - Playwright (Pixel 7): the Registrar downloads the rendered PDF, emails it and revokes the unofficial copy; the verify page then shows it revoked.
