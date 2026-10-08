# 21: CSV imports: students, Lecturers, enrollments

**What to build:** The Academic Admin onboards existing GLIM data by uploading CSVs: a dry run first, then a commit, with a downloadable error file and invites for imported users (TRD §15.2, D-04).

**Blocked by:** 10 (Lecturers, Course Offerings and lecturer assignments)

**Status:** done

- [x] Templates downloadable per kind; files stored in Spaces
- [x] Dry run is the default; commit requires an unchanged file hash (`IMPORT_FILE_CHANGED`)
- [x] STUDENTS (with existing Matric Numbers, study mode, Level, programme), LECTURERS and COURSE_ENROLLMENTS upsert by natural keys in batches of 200 inside transactions, resumable by offset
- [x] Row-level error CSV; imported users get invites (rate-capped) and referral codes
- [x] A 5,000-row import completes in under 60 s in CI

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Flow:** the Academic Admin (`identity:import:run`) uploads the CSV straight to the bucket (upload purpose `IMPORT`), then `POST /imports {kind, fileId, dryRun}` (Idempotency-Key) queues an `import.run` job in the same transaction. `GET /imports` and `GET /imports/:id` report progress; `GET /imports/templates/:kind` downloads the template.
- **Dry run:** the default. Each batch of 200 is applied inside a transaction and rolled back, so the counts match a commit exactly. A commit needs a completed dry run of the same file and kind, and the same SHA-256 (`IMPORT_FILE_CHANGED`); the job checks the hash again before running.
- **Kinds:**
  - `STUDENTS`: user by email, student profile, programme enrollment by Matric Number (with Study Mode, Level, the programme's active curriculum and the entry Academic Session).
  - `LECTURERS`: by staff code, then the account's email.
  - `COURSE_ENROLLMENTS`: Matric Number + course + session + semester + section; creates the semester enrollment if needed and writes `course_enrollment_events`.
  - `COURSE_RESULTS` waits for ticket 39.
- **Batches and resume:** each row runs in a savepoint, so one bad row doesn't spoil its batch. A commit saves `rows_done` with every batch and a retried job resumes there.
- **Errors:** Zod validation and constraint failures become row errors in a downloadable error CSV (row number, message, original cells).
- **Invites:** new users get a referral code and an `identity.invite` job, spread at 20 a second; anyone who has already accepted is skipped.
- **Shared code:** `parseCsv` in shared; `withSavepoint` in db; `FilesService.read/store`; the web upload helper is now shared by passport photos and imports.
- **Fix found by the e2e test:** the web API client discarded every 202 body, so the page never saw the new import's id. It now parses a 202 body when there is one.
- **Tests:** `imports.itest.ts` (templates, dry run writes nothing, error CSV, commit gating, file changed, idempotent re-run, invites spread out, Lecturers by staff code, course enrollments on past offerings, 5,000 rows each way under a minute with resume); authz samples for the four endpoints; `withSavepoint` and `parseCsv` tests; Playwright: check then import a Lecturers CSV.
