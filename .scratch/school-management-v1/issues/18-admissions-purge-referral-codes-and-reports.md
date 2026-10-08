# 18: Admissions purge, referral codes and reports

**What to build:** Old rejected, lapsed, withdrawn and stale-draft applications are deleted after 12 months with their photos. Referrers get credit, and Admissions Officers see intake and referral reports (TRD §10.5–10.6, C-29, D-06).

**Blocked by:** 16 (Offer acceptance creates the student)

**Status:** done

- [x] Daily purge hard-deletes the application, its events and its photo file; the audit keeps only the reference number and final status; role-less applicant users with nothing left are deactivated
- [x] Referral codes for students, alumni and staff (7 chars, no ambiguous characters) shown on profiles; case-insensitive matching on submit
- [x] Reports: counts by status, programme, study mode, country and heard-via; a referral report by referrer, as CSV or JSON
- [x] Export with an optional sensitive-answers flag, restricted to Admissions Officer and System Admin and audited

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Daily `admissions.purge` (`PurgeService`, worker handler):**
  - Purges REJECTED, LAPSED and WITHDRAWN applications once `purge_after` passes, and drafts not edited for the policy's 12 months (D-06).
  - Each purge is one transaction: the application, its events (cascade), the in-app notifications about it, and its photo file record unless a student record uses it.
  - The bucket object is removed after commit.
  - The audit row keeps only `{referenceNo, finalStatus}`.
  - Afterwards, applicants with no remaining application, staff role, student record or Lecturer profile are deactivated, with their sessions revoked. Tests run the clock forward 300 and 366 days.
- **Referral codes:** 7 characters of base32 without look-alikes (`ensureReferralCode`, ticket 16).
  - Now also created on staff invite, when an existing user becomes a Lecturer, and when a staff role is granted.
  - Shown on the profile (`/me` `user.referralCode`).
  - Matched case-insensitively on submit (ticket 15).
- **Reports (`admissions:report:read`):**
  - `GET /reports/admissions?intakeId=`: submitted applications by status, programme, study mode, country and heard-via, plus drafts in progress.
  - `GET /reports/referrals?intakeId=`: each referrer with their applicants and how many were admitted or accepted, plus codes that matched nobody.
  - Both accept `format=csv`.
- **Export (`GET /admissions/applications/export`, `admissions:application:read`):**
  - One row per submitted application, CSV (default) or JSON.
  - `includeSensitive=true` adds section 5 only for `read-sensitive` holders (otherwise 403).
  - Every export is audited with its scope (intake, sensitive flag, format, count), never its contents.
- **CSV support:** `toCsv` in shared (RFC 4180, CRLF, formula-injection guard; unit tested) and a `Csv` reply type that the response interceptor sends as an attachment.
- **Web:**
  - The Admissions "Reports" page has an intake picker, count tables, referral table, unmatched codes, CSV downloads and the export. Including confidential answers needs a second click.
  - The profile shows the referral code.
- **Tests:**
  - `purge.itest.ts`, `reports.itest.ts`, and authz samples for the three new endpoints.
  - Playwright: the student sees their code, and the officer's report counts the application.
