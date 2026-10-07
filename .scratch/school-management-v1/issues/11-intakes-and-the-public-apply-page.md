# 11: Intakes and the public apply page

**What to build:** An Admissions Officer creates the yearly intake linked to its Academic Session. The public `/apply` page shows the programmes, intake dates and Statement of Faith link, and says clearly when applications are closed (TRD §10.1).

**Blocked by:** 06 (Institution settings, policies and viewer timezone); 09 (Academic calendar and Rooms)

**Status:** done

- [x] Intakes CRUD (Admissions Officer, System Admin): code, Academic Session, opens/closes dates, offer acceptance days (default 21)
- [x] Daily cron opens and closes intakes by date (in the Lagos zone); manual override
- [x] `GET /public/intakes/current` returns programmes, dates and the Statement of Faith URL with no authentication
- [x] `/apply` landing page within the route budget, mobile-first
- [x] Tests: closed intake shows the closed state; cron transitions at date boundaries

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-07).**
- **Schema:** `intakes` has a code, its Academic Session (one intake per session), opens/closes dates, offer acceptance days (default 21) and a status of PLANNED, OPEN or CLOSED. Checks require the intake to close after it opens and offer acceptance days to be positive.
- **Intake management:** `admissions:intake:manage` (Admissions Officer and System Admin) covers listing, creating and updating intakes (with If-Match), plus `POST /intakes/:id/open` and `/close` as manual overrides. Every change is audited in the same transaction.
- **Daily job:** `admissions.intake-status` opens and closes intakes by today's date in the institution's timezone (Lagos). It only moves an intake forward, so a manual early open or close sticks.
- **Public endpoint:** `GET /public/intakes/current` needs no authentication. It returns the open intake (else the next planned one, else the latest closed one), the active programmes and the Statement of Faith URL.
- **Screens:** `/apply` is mobile-first and states plainly when applications aren't open; it stays within the route budget. Admissions has its own Intakes screen.
- **Tests:**
  - API: CRUD, manual overrides, and the public endpoint showing the closed state.
  - Authz: deny paths for the "intake" resource.
  - Worker: Lagos-time transitions at the date boundaries, and an intake closed early by hand staying closed.
  - Playwright: the Admissions Officer plans, opens and closes the intake, and an applicant sees `/apply` go from open to closed.
- **Closed banner:** when applications are closed, `/apply` says so without a date, because an early manual close happens before the scheduled closing date.
- **E2E fixture change:** the e2e seed now plans a 2030/2031 session. Session cards on the calendar page carry their session name as an accessible label, so the academic spec clicks within its own session's card.
