# 09: Academic calendar and Rooms

**What to build:** The Academic Admin creates Academic Sessions (September–June) with two semesters and exam periods, moves them through their lifecycles, and manages Rooms (TRD §9.1, C-32).

**Blocked by:** 08 (Programmes, courses and curricula)

**Status:** ready-for-agent

- [ ] Academic Sessions: planned → active → closed, with at most one active
- [ ] Semesters inside their session, non-overlapping, with registration dates, add/drop deadline and exam period; lifecycle planned → registration → active → closed (side effects of open-registration and close come in tickets 19 and 22)
- [ ] Rooms CRUD (code, name, informational capacity, archive)
- [ ] Admin calendar screens show dates in the viewer's timezone

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
