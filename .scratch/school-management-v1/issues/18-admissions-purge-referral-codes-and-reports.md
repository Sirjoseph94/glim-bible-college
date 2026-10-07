# 18: Admissions purge, referral codes and reports

**What to build:** Old rejected, lapsed, withdrawn and stale-draft applications are deleted after 12 months with their photos. Referrers get credit, and Admissions Officers see intake and referral reports (TRD §10.5–10.6, C-29, D-06).

**Blocked by:** 16 (Offer acceptance creates the student)

**Status:** ready-for-agent

- [ ] Daily purge hard-deletes the application, its events and its photo file; the audit keeps only the reference number and final status; role-less applicant users with nothing left are deactivated
- [ ] Referral codes for students, alumni and staff (7 chars, no ambiguous characters) shown on profiles; case-insensitive matching on submit
- [ ] Reports: counts by status, programme, study mode, country and heard-via; a referral report by referrer, as CSV or JSON
- [ ] Export with an optional sensitive-answers flag, restricted to Admissions Officer and System Admin and audited

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
