# 11: Intakes and the public apply page

**What to build:** An Admissions Officer creates the yearly intake linked to its Academic Session. The public `/apply` page shows the programmes, intake dates and Statement of Faith link, and says clearly when applications are closed (TRD §10.1).

**Blocked by:** 06 (Institution settings, policies and viewer timezone); 09 (Academic calendar and Rooms)

**Status:** ready-for-agent

- [ ] Intakes CRUD (Admissions Officer, System Admin): code, Academic Session, opens/closes dates, offer acceptance days (default 21)
- [ ] Daily cron opens and closes intakes by date (in the Lagos zone); manual override
- [ ] `GET /public/intakes/current` returns programmes, dates and the Statement of Faith URL with no authentication
- [ ] `/apply` landing page within the route budget, mobile-first
- [ ] Tests: closed intake shows the closed state; cron transitions at date boundaries

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
