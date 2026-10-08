# 16: Offer acceptance creates the student

**What to build:** An admitted applicant accepts before the deadline and instantly becomes a student with a Matric Number and an active programme enrollment, and gets a welcome email (TRD §10.4, AC-16).

**Blocked by:** 15 (Admissions review and decision)

**Status:** done

- [x] One transaction: lock the application; `OFFER_EXPIRED` after expiry
- [x] Create the student (or reuse an existing one, e.g. a Certificate graduate), copying only name, title, gender, date of birth, nationality, phones, address, church and photo; never spiritual background, marital status or occupation
- [x] Gap-free Matric Number `GLIM/{CERT|DIP}/{YYYY}/{NNNN}` under concurrency (D-01)
- [x] Get-or-create the cohort; programme enrollment with the active curriculum, entry session, study mode, Level 1
- [x] Personal referral code ensured; the welcome email shows the Matric Number; the Academic Admin is notified
- [x] Offer page with an expiry countdown and an "Accept offer" button

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Accept (`POST /applications/:id/accept`, `own-accept`, `Idempotency-Key`):** one transaction, which:
  1. locks the application;
  2. requires ADMITTED and an unexpired offer (`OFFER_EXPIRED` afterwards);
  3. gets or creates the cohort (`{programme}-{intake}`);
  4. creates the student, or refreshes an existing one (e.g. a Certificate graduate);
  5. allocates the Matric Number;
  6. creates the ACTIVE programme enrollment;
  7. ensures a referral code;
  8. records the transition (event, audit, `admissions.application.accepted`);
  9. queues the welcome email and notifies each Academic Admin in-app.
- **Schema (migration 0018):**
  - `students` has no columns for spiritual background, marital status or occupation (INV-15); the test checks the copied fields and the absent ones.
  - `matric_sequences` allocates `GLIM/{CODE}/{YYYY}/{NNNN}` under a row lock. Five concurrent acceptances got 0001–0005 with no gaps.
  - `programme_enrollments` records the active curriculum, entry session, study mode, Level 1 and the `one_active_programme_enrollment` index; `cohorts` is in its own schema file.
- **Modules:**
  - New `enrollment` module (`StudentsService.admit`). It registers curriculum usage, so a curriculum that has enrollments is locked.
  - `CohortsService` and `CurriculaService.activeFor` in academic; `UserService.ensureReferralCode` (7-character base32 without look-alikes) in identity; `RoleService.holders` in authorization.
  - `/me` now reports `isStudent` (an ACTIVE student row).
- **Views:** the applicant view (and the staff view) carry `offer.expiresAt` and `enrollment.matricNumber`.
- **Web:** the status page shows the offer with a live countdown ("N days, H hours left") and an Accept button (one Idempotency-Key per attempt). After accepting, it shows the Matric Number and next steps; a lapsed offer explains how to ask for it to be reopened.
- **Tests:**
  - API: acceptance, replay and a second accept refused, `isStudent`, the copied fields, the enrollment and cohort, referral code, welcome email and Academic Admin notification, expiry, concurrent numbering, and owner-only access.
  - Authz: the accept sample for every persona.
  - Playwright: the applicant accepts and sees GLIM/DMIN/2030/0001, and the welcome email arrives.
- **Deferred:** opening registration in an already-open semester waits for ticket 19 (recorded in the implementation notes).
