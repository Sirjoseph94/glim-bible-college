# 09: Academic calendar and Rooms

**What to build:** The Academic Admin creates Academic Sessions (September–June) with two semesters and exam periods, moves them through their lifecycles, and manages Rooms (TRD §9.1, C-32).

**Blocked by:** 08 (Programmes, courses and curricula)

**Status:** done

- [x] Academic Sessions: planned → active → closed, with at most one active
- [x] Semesters inside their session, non-overlapping, with registration dates, add/drop deadline and exam period; lifecycle planned → registration → active → closed (side effects of open-registration and close come in tickets 19 and 22)
- [x] Rooms CRUD (code, name, informational capacity, archive)
- [x] Admin calendar screens show dates in the viewer's timezone

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-07).**
- **Database-enforced rules (INV-4):**
  - an exclusion constraint stops sessions overlapping each other
  - another stops semesters overlapping within a session
  - a partial unique index allows only one ACTIVE session
  - CHECKs keep registration, add/drop and exam dates consistent and inside the semester
- **Service-level rules:**
  - a semester must lie within its session's dates
  - semester 1 comes before semester 2
  - database violations become clear 409/400 messages through `pgError`
- **Lifecycles:**
  - Sessions: PLANNED → ACTIVE → CLOSED. A session closes only after all its semesters are closed.
  - Semesters: PLANNED → REGISTRATION (needs an active session) → ACTIVE → CLOSED. Anything else is `SEMESTER_STATE_INVALID`.
  - `academic.session.activated`, `academic.semester.registration-opened` and `academic.semester.closed` are published in the same transaction. Their consumers (registration, progression, close) come in tickets 19 and 22.
- **Rooms:** CRUD with an informational capacity and archiving.
- **Audit:** every change is audited.
- **Deny tests:** cover every new endpoint.
- **Screens:**
  - The calendar screen shows calendar dates as institution dates, the same in every timezone (§5.1: dates without a time belong to the institution's calendar). Instants elsewhere use `<Time>` with Lagos alongside.
  - Playwright covers session → semester → open registration → Room.
- **Cleanup:** the repeated "keep only defined fields" logic is now `definedFields` in `shared`.
