# 19: Open registration: compulsory courses auto-registered

**What to build:** When the Academic Admin opens a semester's registration, every active student is registered for their compulsory courses, and students see their registered courses for the semester (TRD §9.3, AC-03).

**Blocked by:** 10 (Lecturers, Course Offerings and lecturer assignments); 16 (Offer acceptance creates the student)

**Status:** ready-for-agent

- [ ] `semester.open-registration` (idempotent, per programme enrollment) creates the semester enrollment and course enrollments (`selection='COMPULSORY'`) for published offerings at the student's Level/semester
- [ ] A missing offering produces an ops warning and a notification to the Academic Admin
- [ ] Students accepted after registration opened are registered inside the acceptance transaction
- [ ] Course-enrollment consistency trigger (student and programme enrollment match the semester enrollment)
- [ ] The Student authorization path via `v_offering_access` is implemented with deny tests (ENROLLED vs COMPLETED rules)
- [ ] Student `/registration` and `/courses` pages

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
