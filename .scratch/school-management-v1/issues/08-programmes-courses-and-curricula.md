# 08: Programmes, courses and curricula

**What to build:** The Academic Admin sets up the Certificate and Diploma programmes, the course catalogue, and versioned curricula placing each course as compulsory or elective at a Level and semester (TRD §6.3, §9.1).

**Blocked by:** 04 (Authorization framework, user & role admin, audit log)

**Status:** done

- [x] Programmes (code, award type, duration, Levels) and courses (code, title, credits) with CRUD screens
- [x] Curricula: draft → active → retired; only one active per programme; activation needs at least one placement
- [x] Placements per Level/semester with compulsory/elective type and credit override; `min_elective_credits`
- [x] An active curriculum with enrollments can't be edited (`CURRICULUM_LOCKED`); clone creates a new version
- [x] Deny tests: only System Admin and Academic Admin can manage; everyone signed in can read

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-07).**
- **Schema:** M02 programmes, courses, curricula and curriculum placements. A partial unique index allows only one ACTIVE curriculum per programme.
- **Credits:** exact one-decimal strings end to end (`"2.5"`), never floats (INV-14).
- **Curricula:**
  - Placements are replaced as a whole under `If-Match`. They're validated for unknown, archived or duplicate courses and for a Level above the programme's.
  - Activation needs at least one placement and retires the previous ACTIVE curriculum.
  - Clone creates the next draft version. Version numbers are serialised per programme with an advisory lock.
- **`CURRICULUM_LOCKED`:** RETIRED curricula are locked. "ACTIVE with enrollments" uses a `CurriculaService.registerUsage` hook, which the enrollment module wires up in ticket 16. Until then no curriculum has enrollments, so that rule isn't exercised yet.
- **Authorization:** reads need `academic:structure:read` (all staff roles now; lecturers and students when those paths land). Management needs System Admin or Academic Admin. Deny tests cover every new endpoint.
- **Audit:** every change is audited.
- **Screens:** Academic Admin screens for programmes, courses and the curriculum editor. Playwright covers programme → courses → curriculum → activate.
- **Fix found by e2e:** the header now wraps on narrow phones.
