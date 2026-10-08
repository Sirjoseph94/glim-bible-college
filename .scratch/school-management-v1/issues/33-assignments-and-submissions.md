# 33: Assignments and submissions

**What to build:** Lecturers set assignments with due dates, cutoffs and late rules; students submit files or text (resubmitting until the cutoff); Lecturers grade with feedback (TRD §14.2).

**Blocked by:** 32 (Course materials and announcements)

**Status:** done

- [x] Assignment create/publish backed by an ASSIGNMENT assessment created atomically
- [x] Submissions with attempts ≤ max, server-side late flag, cutoff enforcement (`SUBMISSION_CLOSED`)
- [x] Draft autosave for text submissions; files ≤ 20 MB
- [x] Grading screen with feedback; grade writes are audited (gradebook display comes in ticket 35)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Schema** (`0032`): `assessments`, `assignments`, `assignment_submissions` (one draft per student via a partial unique index), `submission_files`, `grades`, `grade_changes`.
- **Domain:** `assessment/domain/late.ts` (`closesAt`, `isOpen`, `isLate`, `daysLate`, `suggestedPenaltyPercent`) with table tests.
- **API** (module `assessment`):
  - Assignments: `GET/POST /course-offerings/:id/assignments`, `GET/PATCH /assignments/:id` (If-Match) and `POST /assignments/:id/publish`. Creating writes the ASSIGNMENT assessment in the same transaction; publishing publishes both.
  - Submissions: `GET /assignments/:id/my-submissions`, `PUT …/draft`, `POST …/submit` (Idempotency-Key). The server times submissions and sets the late flag; `SUBMISSION_CLOSED` after closing; `ATTEMPT_LIMIT_REACHED`.
  - Grading: `GET /assignments/:id/submissions`, `GET /assignment-submissions/:id/files/:fileId/download`, and `PUT /assessments/:id/grades/:studentId` (exact two-place scores ≤ max, history and audit in the same transaction).
- **Web:**
  - Lecturer's page → Assignments: create (due, cutoff, attempts, late work and penalty, file/text, marks, weight), publish, and "Grade submissions".
  - Grading page: each student's latest attempt with lateness and the suggested penalty, plus score and feedback.
  - Student: My courses → Assignments → the assignment page: instructions, past attempts, a draft with 2 s autosave, file upload (SUBMISSION, ≤ 20 MB) and Submit.
- **Tests:**
  - `assignments.itest.ts` (14): atomic column; validation; who may set work; student visibility; If-Match edit; draft, autosave, files and submit; attempt limit; empty, wrong type and someone else's file; finished students read only; late flag, days late, penalty and cutoff; closing at the due date; the grading list for graders only; file downloads; exact scores, If-Match, history and audit without feedback text; students off the course.
  - Authz samples for all eleven endpoints.
  - Playwright: set, publish, submit (autosave and file), grade.
