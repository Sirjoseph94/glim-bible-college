# 42: Transcript PDF, delivery, revoke and supersede

**What to build:** Issued transcripts render as A4 PDFs with a QR code and hash, students download them, the Registrar emails them to recipients, and revoked or superseded transcripts show that status when verified (TRD §14.7, AC-15).

**Blocked by:** 41 (Transcript requests, issue and public verification)

**Status:** ready-for-agent

- [ ] `transcript.generate` renders from the snapshot only: header/footer every page, page n of N, embedded Unicode fonts (Yoruba/Igbo tonal marks test), QR to `/verify/<code>`, serial + short hash; unofficial watermark
- [ ] Stored as a file in Spaces; student download authorized
- [ ] Registrar emails the PDF (≤ 5 MB attachment or expiring link)
- [ ] Revoke with a reason (audited); reopening a result marks affected transcripts SUPERSEDED; the verify page shows the status
- [ ] Spike S-16 recorded

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
