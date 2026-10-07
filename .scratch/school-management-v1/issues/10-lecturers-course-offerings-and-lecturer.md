# 10: Lecturers, Course Offerings and lecturer assignments

**What to build:** The Academic Admin creates Lecturer profiles and Course Offerings for a semester, assigns Lecturers by role, and publishes offerings. Lecturers see "My offerings" (TRD §9.2, §9.4, §7.4).

**Blocked by:** 09 (Academic calendar and Rooms)

**Status:** ready-for-agent

- [ ] Lecturer profiles linked to users (internal/guest)
- [ ] Course Offerings per course + semester + section; lifecycle draft → published → active → completed / cancelled
- [ ] Lecturer assignments with roles PRIMARY, CO_LECTURER, ASSISTANT, GUEST_LECTURER; exactly one active PRIMARY (DB index); PRIMARY swap is transactional; ending the last PRIMARY is rejected (`PRIMARY_REQUIRED`)
- [ ] Publishing requires an active PRIMARY
- [ ] The Lecturer path of `AuthorizationService` (capability table §7.4) is implemented and covered by deny tests
- [ ] Lecturer "My offerings" screen; admin offering screens

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
