# 45: Data rights: export and erasure

**What to build:** Any user can download their own data; the System Admin can erase or anonymise a person while keeping academic records the law requires (TRD §19.4).

**Blocked by:** 18 (Admissions purge, referral codes and reports)

**Status:** ready-for-agent

- [ ] `GET /me/data-export` returns the caller's data as JSON (applicants include their own application answers)
- [ ] Admin erasure/anonymisation workflow: profile anonymised, academic records retained with a pseudonymous id; audited
- [ ] Processing register export and the breach runbook in `docs/`

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
