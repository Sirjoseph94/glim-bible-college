# 37: Grading schemes, award classes and GPA functions

**What to build:** The Registrar manages grading schemes per programme (NUC 5-point bands and award classes), and the pure GPA and award-class functions are proven against the golden examples (TRD §14.4, C-31).

**Blocked by:** 08 (Programmes, courses and curricula)

**Status:** ready-for-agent

- [ ] Seeded schemes `GLIM Certificate` and `GLIM Diploma`: NUC 5 bands; Distinction 4.50–5.00, Credit 3.00–4.49, Pass 1.00–2.99, no award below 1.00; repeat policy BEST; good standing 1.00 (D-02)
- [ ] Schemes immutable once used (`SCHEME_LOCKED`); edits create a new row
- [ ] Pure functions: final percent, banding, semester result, CGPA with KEEP_ALL/REPLACE_LATEST/BEST, standing, award class
- [ ] All Appendix C.2/C.3 vectors pass, plus property tests for half-up rounding, band boundaries, award-class boundaries (4.50/4.49, 3.00/2.99, 1.00/0.99) and zero-credit semesters
- [ ] Registrar scheme management screen

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
