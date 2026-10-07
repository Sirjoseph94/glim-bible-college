# 39: Semester results, broadsheet and legacy results import

**What to build:** The Registrar computes, approves and publishes semester results in bulk, exports the broadsheet, and imports past results for existing students so CGPAs are complete (TRD §14.5, §15.2, D-04).

**Blocked by:** 38 (Course result finalization and student results view); 22 (Progression and semester close); 21 (CSV imports: students, Lecturers, enrollments)

**Status:** ready-for-agent

- [ ] `results.compute-semester` on semester close and on demand; idempotent; `calc_version` bumps only on change
- [ ] Approve and publish in bulk by programme/cohort/semester (`Idempotency-Key`); the Provisional label disappears on publish
- [ ] Reopen cascades the semester result back to DRAFT
- [ ] Broadsheet CSV: credits, GPA, CGPA, standing
- [ ] `COURSE_RESULTS` import creates APPROVED imported results that count in CGPA (test), then enqueues compute
- [ ] CGPA is per programme enrollment: Certificate results don't count in the Diploma (test)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
