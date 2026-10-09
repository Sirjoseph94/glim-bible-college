# 41: Transcript requests, issue and public verification

**What to build:** Students request unofficial (auto-issued) or official transcripts; the Registrar approves and issues them with a serial number and hash; anyone can verify a transcript's status at a public page (TRD §14.7, AC-14).

**Blocked by:** 39 (Semester results, broadsheet and legacy results import)

**Status:** done

- [x] Requests: unofficial auto-issue (5/day limit), official needs approval; reject with a reason
- [x] Issue (`Idempotency-Key`): canonical snapshot JSON (Matric Number, semesters, GPA/CGPA, award + class if conferred, legend), SHA-256, serial `GLIM/TR/{YYYY}/{NNNNN}`, 16-char verification code
- [x] Official requires approved/published semesters (`TRANSCRIPT_NOT_ISSUABLE`); unofficial marks unapproved semesters Provisional
- [x] Transcripts immutable except status (trigger)
- [x] `verify_transcript(code)` SQL function and the public `/verify/:code` page showing only minimal fields; rate-limited
- [x] Hash stable for identical input and changes when any field changes

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-09).**
- **Schema** (`0040`, `0041`): transcript sequences, requests and transcripts; the immutability trigger; and `verify_transcript(code)`.
- **Module `transcripts`:** canonical JSON, SHA-256 and verification codes (`domain/canonical.ts`), the snapshot builder, and `TranscriptsService` (request with auto-issue and the daily limit, approve, reject, issue, get, verify). It registers loaders for `programme-enrollment` and `transcript`.
- **API:**
  - `POST /programme-enrollments/:id/transcript-requests`.
  - `GET /me/transcripts`.
  - `GET /transcript-requests`.
  - `POST /transcript-requests/:id/approve|reject|issue`.
  - `GET /transcripts/:id`.
  - `GET /public/transcripts/:code` (rate-limited).
- **Authorization:** graduates keep own-only rules; `/me` has `isAlumnus`.
- **Web:** Transcripts for students and graduates, a transcript view, the Registrar's Transcript requests, and the public `/verify/:code`.
- **Tests:**
  - Unit (8): canonical JSON (key order at every level, tonal marks, key-order property), the hash stable for identical input and changing when any field changes, and verification codes.
  - `transcripts.itest.ts` (9):
    - unofficial issue (snapshot fields, Provisional, hash of the stored snapshot, audit), the 5-a-day limit and gap-free serials, and owner-only access;
    - official (validation, queue, issue before approval refused, `TRANSCRIPT_NOT_ISSUABLE`, issue after approval, idempotent re-issue, email queued) and rejection with a reason;
    - the immutability trigger (no snapshot or serial change, no delete, status can change);
    - verification (exact minimal keys, revoked shows invalid, unknown 404, bad code 400) and its rate limit;
    - a graduate keeping their transcripts.
  - Authz samples for the seven endpoints with a permission (the oracle now knows the graduate rule).
  - Playwright (Pixel 7): a graduate gets an unofficial transcript and asks for an official one; the Registrar approves and issues it; it verifies while signed out.
