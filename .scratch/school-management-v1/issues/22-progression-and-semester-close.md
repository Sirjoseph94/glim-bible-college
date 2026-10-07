# 22: Progression and semester close

**What to build:** Activating a new Academic Session moves Year 1 Diploma students to Year 2. Closing a semester completes its offerings and enrollments and queues results computation (TRD §9.1, D-03).

**Blocked by:** 19 (Open registration: compulsory courses auto-registered)

**Status:** ready-for-agent

- [ ] Session activation runs `academic.progression` idempotently, audited per enrollment
- [ ] Semester close marks offerings COMPLETED (`completed_at`) and ENROLLED course enrollments COMPLETED, and emits `academic.semester.closed`
- [ ] Completed enrollments keep read-only access to materials and recordings while the programme enrollment is active (test)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
