# 06: Institution settings, policies and viewer timezone

**What to build:** The System Admin edits institution settings and versioned policies, and every user sees times in their own timezone with Lagos time alongside (TRD §5.1, §6.2, C-27).

**Blocked by:** 04 (Authorization framework, user & role admin, audit log)

**Status:** ready-for-agent

- [ ] Settings: name, timezone, staff email domains, Statement of Faith URL, YouTube channel URLs (`If-Match` versioning)
- [ ] Policies API: append-only versions per type, with Zod schemas in `contracts` (ATTENDANCE, RECORDING, JOIN_WINDOW, NOTIFICATION, ADMISSIONS, GRADING_DEFAULTS)
- [ ] `users.timezone` set from the browser on first sign-in and editable on the profile
- [ ] A shared UI time component renders the viewer's zone, plus "(HH:mm Lagos)" when it differs; tested with Lagos and London viewers
- [ ] Settings and policies screens for the System Admin

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
