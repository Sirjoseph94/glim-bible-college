# 39: Semester results, broadsheet and legacy results import

**What to build:** The Registrar computes, approves and publishes semester results in bulk, exports the broadsheet, and imports past results for existing students so CGPAs are complete (TRD §14.5, §15.2, D-04).

**Blocked by:** 38 (Course result finalization and student results view); 22 (Progression and semester close); 21 (CSV imports: students, Lecturers, enrollments)

**Status:** done

- [x] `results.compute-semester` on semester close and on demand; idempotent; `calc_version` bumps only on change
- [x] Approve and publish in bulk by programme/cohort/semester (`Idempotency-Key`); the Provisional label disappears on publish
- [x] Reopen cascades the semester result back to DRAFT
- [x] Broadsheet CSV: credits, GPA, CGPA, standing
- [x] `COURSE_RESULTS` import creates APPROVED imported results that count in CGPA (test), then enqueues compute
- [x] CGPA is per programme enrollment: Certificate results don't count in the Diploma (test)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-09).**
- **Schema** (`0038`): `semester_results`, and a partial unique index for imported course results.
- **Service** (`SemesterResultsService`): compute (idempotent, `calc_version` bumps only on change, later semesters follow), approve and publish in bulk, the reopen cascade, list, and the broadsheet.
- **Worker:** the `results.compute-semester` handler and the `academic.semester.closed` subscriber.
- **API:** `GET /results/semesters`, `POST /results/semesters/compute`, `/approve` and `/publish`, and `GET /reports/results` (JSON or CSV).
- **Import:** the `COURSE_RESULTS` kind (`recordImportedResult` in the results module), queueing recomputation per batch.
- **Web:** Semester results for the Registrar; the past-results import kind.
- **Tests:**
  - `semester-results.itest.ts` (8):
    - computing (figures, standing, idempotence and `calc_version`) and the semester-closed subscriber queueing it;
    - legacy import (APPROVED, letter from the scheme, row errors), the queued recompute carrying the CGPA to 4.60, and re-importing changing nothing;
    - the Certificate kept out of the Diploma's CGPA;
    - approve by programme (Registrar only) and publish (Provisional gone, notices, audit);
    - the reopen cascade and approval skipping;
    - the broadsheet CSV.
  - Authz samples for the five endpoints.
  - Playwright (Pixel 7): the Lecturer finalizes again, the Registrar computes, approves and publishes, and the student's results are no longer Provisional.
