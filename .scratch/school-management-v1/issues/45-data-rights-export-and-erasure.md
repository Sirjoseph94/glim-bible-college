# 45: Data rights: export and erasure

**What to build:** Any user can download their own data; the System Admin can erase or anonymise a person while keeping academic records the law requires (TRD §19.4).

**Blocked by:** 18 (Admissions purge, referral codes and reports)

**Status:** done

- [x] `GET /me/data-export` returns the caller's data as JSON (applicants include their own application answers)
- [x] Admin erasure/anonymisation workflow: profile anonymised, academic records retained with a pseudonymous id; audited
- [x] Processing register export and the breach runbook in `docs/`

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-09).**
- **Module `privacy`:** `DataRightsService` (export, erase).
- **API:** `GET /me/data-export` and `POST /users/:id/erase`.
- **Authorization:** a new permission, `identity:user:erase`.
- **Web:** "Download my data" on the profile page; "Erase personal data" on the admin user page.
- **Docs:** `docs/compliance/ropa.md` (processing register) and `docs/runbooks/breach.md`.
- **Tests:**
  - `privacy.itest.ts` (3):
    - the export holds the person's own data, including their application answers, with no secrets or other people's data;
    - erasure is refused for others, for the caller, for staff and for an unknown user;
    - erasure anonymises the account, removes sign-ins, sessions (signed out at once), notifications, the application with its sensitive answers and the photo, and keeps the programme enrollment and Matric Number; it's audited without personal details, and erasing again changes nothing.
  - An authz sample for the erase endpoint.
  - Playwright (Pixel 7): a graduate downloads their data; the System Admin erases them; they can no longer sign in.
