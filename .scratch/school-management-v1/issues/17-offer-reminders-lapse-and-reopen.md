# 17: Offer reminders, lapse and reopen

**What to build:** Admitted applicants get reminders 7 and 2 days before their offer expires; unaccepted offers lapse automatically; an Admissions Officer can reopen a lapsed offer with a reason (TRD §10.3).

**Blocked by:** 16 (Offer acceptance creates the student)

**Status:** done

- [x] Hourly `admissions.offer-sweep`: reminders deduplicated per offer, lapse at expiry with a lapse email and `purge_after`
- [x] Reopen-offer sets a new expiry, clears `purge_after`, is audited and requires a reason
- [x] Tests drive time with the Clock to cover each boundary

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Hourly `admissions.offer-sweep`** (`OffersService.sweep`, worker handler; the cron already existed):
  - **Lapse:** offers past `offer_expires_at` lapse to LAPSED, one transaction each, row-locked. They get `purge_after` = now + the policy's 12 months, a recorded transition (`admissions.application.lapsed`) and a lapse email.
  - **Reminders:** sent at the ADMISSIONS policy's `offerReminderDaysBefore` (7 and 2). Only the most urgent one that's due goes out. Each is deduplicated per offer, deadline and threshold through the notifications dedupe key, so a reopened offer gets fresh reminders.
- **Reopen (`POST /admissions/applications/:id/reopen-offer`, `decide`):**
  - A reason of 3–500 characters is required, and only a LAPSED application can be reopened.
  - It gets a new deadline (now + the intake's acceptance days) and `purge_after` is cleared.
  - It's audited as `admissions.application.offer-reopened` with the reason, which is also kept as a staff note. The applicant is emailed the offer again.
  - `recordTransition` gained an optional verb for this.
- **Web:** the officer's application page shows "Offer lapsed" with a reason form and a "Reopen offer" button. The applicant's page already explains a lapsed offer (ticket 16).
- **Tests (`offers.itest.ts`, time driven with the TestClock):** each step is measured from the moment of the offer.
  - No reminder at 7 days + 1 minute left; the 7-day reminder at exactly 7 days, once; the same pattern at 2 days.
  - Still open at the exact expiry instant, lapsed a minute later, with the purge date 12 months on and the lapse email, and no second lapse.
  - Reopen: refused without a reason, then the new deadline, purge cleared, audit with the reason, the note, the offer email again, a second reopen refused, and new reminders before the new deadline.
  - Authz covers `reopen-offer` for every persona.
