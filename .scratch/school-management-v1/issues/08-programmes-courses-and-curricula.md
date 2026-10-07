# 08: Programmes, courses and curricula

**What to build:** The Academic Admin sets up the Certificate and Diploma programmes, the course catalogue, and versioned curricula placing each course as compulsory or elective at a Level and semester (TRD §6.3, §9.1).

**Blocked by:** 04 (Authorization framework, user & role admin, audit log)

**Status:** ready-for-agent

- [ ] Programmes (code, award type, duration, Levels) and courses (code, title, credits) with CRUD screens
- [ ] Curricula: draft → active → retired; only one active per programme; activation needs at least one placement
- [ ] Placements per Level/semester with compulsory/elective type and credit override; `min_elective_credits`
- [ ] An active curriculum with enrollments can't be edited (`CURRICULUM_LOCKED`); clone creates a new version
- [ ] Deny tests: only System Admin and Academic Admin can manage; everyone signed in can read

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
