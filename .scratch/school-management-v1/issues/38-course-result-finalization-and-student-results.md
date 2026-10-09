# 38: Course result finalization and student results view

**What to build:** The PRIMARY Lecturer finalizes a course, freezing each student's result; students see their course results immediately and their GPA/CGPA marked Provisional; the Registrar can reopen with a reason (TRD §14.3, C-11).

**Blocked by:** 36 (Hybrid exams); 37 (Grading schemes, award classes and GPA functions)

**Status:** done

- [x] Finalize (`Idempotency-Key`): weights must total 100; missing grades count as 0 once closed; excused grades renormalized; integer arithmetic; gradebook locked
- [x] Frozen fields per TRD §14.3 including credits, letter, points, quality points, programme enrollment and semester
- [x] Reopen (Registrar/System Admin, reason) writes revisions and unlocks
- [x] Student results page: course results on finalization; provisional GPA/CGPA computed on the fly

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-09).**
- **Schema** (`0037`): `course_results`, `course_result_revisions`, and `gradebook_locks` (assessment). The GRADING_DEFAULTS policy gains `missingGradeAsZero` and `roundBeforeBanding`.
- **API:**
  - `GET /course-offerings/:id/results`: finalized results, or a preview with the blocker.
  - `POST /course-offerings/:id/results/finalize`: Idempotency-Key, `WEIGHTS_NOT_100`, frozen fields, scheme and gradebook locks, notices, audit.
  - `POST /course-results/:id/reopen`: reason, revisions, unlock, notice, audit.
  - `GET /me/results`.
  - Grade and column writes refuse with `GRADEBOOK_LOCKED` once finalized.
- **Web:** teaching page → Results (preview and finalize); the Registrar's Course results with Reopen; students' My results with Provisional GPA and CGPA.
- **Tests:**
  - `course-results.itest.ts` (7): the missing-scheme blocker; the Appendix C.2 preview (72.00 A, excused 68.57 B); `WEIGHTS_NOT_100`; Co-Lecturers and students refused; every frozen field, scheme lock, gradebook lock (grades and columns), notice and audit, and finalizing again changing nothing; My results with GPA 5.00, Provisional and GOOD; reopen (roles, reason, `RESULT_NOT_FINALIZED`, revision with old values, the student no longer sees it, only that student unlocked), a missing grade counting 0 (21.43 ⇒ F) and REFINALIZE.
  - Authz samples for the three endpoints with a permission.
  - Playwright (Pixel 7): the Lecturer balances the weights and finalizes, the student sees the result Provisional, and the Registrar reopens it with a reason.
