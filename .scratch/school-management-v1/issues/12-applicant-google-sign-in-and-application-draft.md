# 12: Applicant Google sign-in and application draft

**What to build:** An applicant signs in with Google from `/apply`, chooses Certificate or Diploma and On-campus or Online, and fills in sections 1–8 of the application with autosave, coming back later to finish (TRD §10.2, C-29, C-36).

**Blocked by:** 05 (Google sign-in for staff and account linking); 11 (Intakes and the public apply page)

**Status:** ready-for-agent

- [ ] The `apply` OIDC intent creates a role-less user only from `/apply`; that user becomes an Applicant on starting an application
- [ ] Applicant authorization path (own application only) with deny tests; applicant sessions idle 24 h
- [ ] One open application per applicant per intake (DB index); `INTAKE_CLOSED` when the intake isn't open
- [ ] Draft PATCH with `If-Match` per section; Zod contract mirrors the paper form (title options, marital status, heard-via list, etc.)
- [ ] Wizard UI: section progress, autosave every 5–10 s with "Saved / Offline — will retry", resume where left off
- [ ] Spiritual-background answers are stored but never echoed in logs or audit (INV-15 test)
- [ ] Applicants under 18 at intake start are blocked with `APPLICANT_UNDER_AGE`

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
