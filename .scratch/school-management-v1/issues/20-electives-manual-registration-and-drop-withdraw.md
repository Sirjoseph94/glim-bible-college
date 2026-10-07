# 20: Electives, manual registration and drop/withdraw

**What to build:** Students add or drop electives available to their Level and semester until the add/drop deadline. The Academic Admin registers students manually (e.g. retakes) and withdraws them after the deadline, with reasons (TRD §9.3).

**Blocked by:** 19 (Open registration: compulsory courses auto-registered)

**Status:** ready-for-agent

- [ ] Elective add/drop within the window only; `ELECTIVE_NOT_AVAILABLE`, `REGISTRATION_CLOSED`
- [ ] Optional offering capacity enforced under a row lock (`OFFERING_FULL`); duplicates return `ALREADY_ENROLLED`
- [ ] Manual registration (`selection='MANUAL'`) with a reason; withdraw after the deadline with a reason
- [ ] Status history in `course_enrollment_events`; a `course.enrollment.ended` event
- [ ] Registration UI shows electives with credits and the deadline

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
