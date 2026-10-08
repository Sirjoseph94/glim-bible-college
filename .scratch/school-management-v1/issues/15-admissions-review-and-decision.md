# 15: Admissions review and decision

**What to build:** An Admissions Officer works through a filterable queue, opens an application (marking it Under Review), sees every section including spiritual background, records notes, and admits or rejects. The applicant is emailed (TRD §10.3, INV-15).

**Blocked by:** 14 (Application submit and receipt email)

**Status:** done

- [x] Queue filters by status, programme, study mode; search by name/reference
- [x] Detail endpoint returns spiritual background only with `admissions:application:read-sensitive`; it is absent from list payloads, notifications, logs and audit metadata (tests)
- [x] Decide (`Idempotency-Key`): admit sets `offer_expires_at = decided_at + offer_acceptance_days`; reject sets `purge_after = decided_at + 12 months`
- [x] Neutral decision emails; the internal note is never sent
- [x] Unknown referral codes are flagged on the detail view

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Queue (`GET /admissions/applications`, `admissions:application:read`):**
  - Submitted applications only, oldest first, with cursor paging.
  - Filters for intake, status, programme and study mode, plus search by name or Application Reference No.
  - Each item flags `unmatchedReferral`.
  - The payload has no section 5 fields, and a test checks for the sentinel.
- **Detail (`GET /admissions/applications/:id`):** every section. Spiritual background appears only when the viewer holds `admissions:application:read-sensitive`; that's decided before any transaction opens. Drafts return 404. It also shows the applicant's account, review, decision, the referral match and internal notes.
- **Review:** `POST …/review` (`decide` permission) moves SUBMITTED to UNDER_REVIEW, recording `review_started_at` and `reviewed_by`; it's idempotent. The officer page calls it when an application is opened (story 31).
- **Notes:** `POST …/notes` stores internal notes as status-preserving `application_events`. The applicant never sees them.
- **Decide:** `POST …/decide` (`Idempotency-Key`) works from UNDER_REVIEW only.
  - ADMIT sets `offer_expires_at` = decided_at + the intake's `offer_acceptance_days`.
  - REJECT sets `purge_after` = decided_at + the policy's 12 months.
  - The internal note goes in `decision_note`.
  - An offer or a neutral rejection is emailed through `notify.send`; the note is never sent.
- **Referral codes:** resolved on submit (`users.referral_code`, case-insensitive), so an unknown code is flagged in the queue and the detail view.
- **Shared code:** application transitions write an event, an audit row and a domain event through one shared `recordTransition`. The section mapping and the query are shared by the applicant and staff views.
- **Web:**
  - "Admissions" opens the queue (filters, search, "load more"), which links to Intakes.
  - The application page shows all sections, with confidential section 5, and opens an application for review automatically.
  - It also has notes, and Admit/Reject with a confirm step and an internal note.
- **Tests:** a new `review.itest.ts` covers:
  - the queue's order, filters, search and paging
  - the referral flags
  - sensitive access, drafts private, review idempotent
  - notes hidden from the applicant
  - decide requiring review, and the admit expiry
  - idempotent replay and a second decision refused
  - email wording without the note, and the reject purge date
  - INV-15 across notifications, audit, events, logs and emails

  Authz samples cover all five endpoints for every persona. Playwright follows the officer admitting the applicant through to the offer email.
