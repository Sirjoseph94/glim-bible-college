# 35: Gradebook and grade release

**What to build:** Lecturers see one gradebook per course with weighted columns, enter or import scores, release grades per assessment, and every change is recorded; students see only released grades (TRD §14.2, AC-11).

**Blocked by:** 33 (Assignments and submissions); 34 (Question bank and quizzes)

**Status:** done

- [x] Gradebook view across assessments and enrolled students
- [x] Manual grade entry with `If-Match`; CSV grade import; `grades.source` recorded
- [x] `grade_changes` + audit in the same transaction
- [x] Release per assessment (`Idempotency-Key`); students see only RELEASED grades
- [x] Weights validation available for finalization (`WEIGHTS_NOT_100`)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **API:**
  - `GET /course-offerings/:id/gradebook`: columns with released and unreleased counts, students with Matric Number and Study Mode, and the weight total.
  - `POST /course-offerings/:id/assessments` (hand-entered MANUAL columns) and `PATCH /assessments/:id` (title and weight, If-Match).
  - `POST /assessments/:id/release` (Idempotency-Key): DRAFT to RELEASED, with history, audit and an in-app notice per student.
  - `POST /course-offerings/:id/grades/import`: CSV with dry run; all-or-nothing; source IMPORT.
  - `GET /course-offerings/:id/my-grades`: released and excused grades only.
  - `PUT /assessments/:id/grades/:studentId` now takes `excused` and needs a `reason` to change a released grade.
- **Domain:** one grade write path (`GradesService.write`) shared by hand entry, import and quiz scores, so every change writes `grade_changes` and the audit log in the same transaction. `GradebookService.checkWeights` gives `WEIGHTS_NOT_100` for finalization (ticket 38).
- **Web:** the gradebook page (`/teach/offerings/:offeringId/gradebook`, linked from each offering on the teaching page) and My courses → Grades for students. The assignment grading form asks for a reason once a grade is released.
- **Tests:**
  - `gradebook.itest.ts` (11): the view and who may see it; columns and If-Match; the weights check to the hundredth; release (hidden until released, replay, nothing new, notice, history and audit, later grades wait); Assistants can't release or add columns; reasons for released changes; excusing; CSV dry run, all-or-nothing errors, a clean import with history and audit, the maximum, headers and a foreign column.
  - Authz samples for the six new endpoints.
  - Playwright (Pixel 7): a Lecturer adds a column and enters a score, imports another column from CSV after a check that catches a bad row, releases one column; the student sees only the released grade with its feedback.
