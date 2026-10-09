# 37: Grading schemes, award classes and GPA functions

**What to build:** The Registrar manages grading schemes per programme (NUC 5-point bands and award classes), and the pure GPA and award-class functions are proven against the golden examples (TRD §14.4, C-31).

**Blocked by:** 08 (Programmes, courses and curricula)

**Status:** done

- [x] Seeded schemes `GLIM Certificate` and `GLIM Diploma`: NUC 5 bands; Distinction 4.50–5.00, Credit 3.00–4.49, Pass 1.00–2.99, no award below 1.00; repeat policy BEST; good standing 1.00 (D-02)
- [x] Schemes immutable once used (`SCHEME_LOCKED`); edits create a new row
- [x] Pure functions: final percent, banding, semester result, CGPA with KEEP_ALL/REPLACE_LATEST/BEST, standing, award class
- [x] All Appendix C.2/C.3 vectors pass, plus property tests for half-up rounding, band boundaries, award-class boundaries (4.50/4.49, 3.00/2.99, 1.00/0.99) and zero-credit semesters
- [x] Registrar scheme management screen

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-09).**
- **Schema:** `grading_schemes` and the `programmes.grading_scheme_id` foreign key (`0035`); the two seeded schemes, with existing programmes assigned by award type (`0036`, custom).
- **Domain** (`modules/results/domain/grading.ts`): final percentage, banding with `roundBeforeBanding`, course outcome, semester GPA, CGPA under KEEP_ALL, REPLACE_LATEST and BEST, standing, award class, and scheme validation. Integers and BigInt only.
- **API:** `GET/POST /grading-schemes`, `PATCH /grading-schemes/:id` (`SCHEME_LOCKED` once used), and `PUT /programmes/:id/grading-scheme`. Programmes now show `gradingSchemeId`.
- **Web:** `/admin/grading-schemes` for the Registrar and System Admin.
- **Tests:**
  - Domain (44): every Appendix C.2 and C.3 vector (72.00 A; excused 68.57 → B; 69.50 A/B; GPAs 2.90, 4.00, 4.20; CGPAs 3.39, 3.57, 3.90; credits earned 80). Award-class boundaries 4.50/4.49, 3.00/2.99, 1.00/0.99. Zero-credit semesters (UNKNOWN). EXEMPT, AUDIT and WITHDRAWN results. Property tests: half-up rounding, final percentage bounds, one band per percentage, monotone points, one class per CGPA, and GPA bounds per policy.
  - `grading-schemes.itest.ts` (6): seeds; who may manage; create with validation and name conflicts; in-place edits with If-Match; locking, `SCHEME_LOCKED`, and a new version taking the programmes; an unknown scheme.
  - Authz samples for the four endpoints.
  - Playwright (Pixel 7): the Registrar reviews the seeds, assigns a programme's scheme, adds a probation band, and is told about a gap in the bands.
