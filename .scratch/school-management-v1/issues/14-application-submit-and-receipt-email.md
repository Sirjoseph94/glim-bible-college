# 14: Application submit and receipt email

**What to build:** An applicant reviews missing fields, types their name to sign, ticks the Statement of Faith and consent, and submits. They get an Application Reference No and a receipt email, and can see their status and withdraw (TRD §10.2–10.3).

**Blocked by:** 13 (Passport photo upload)

**Status:** done

- [x] Review page lists missing required fields; submit is blocked until complete (`APPLICATION_INCOMPLETE`)
- [x] Submit is idempotent (`Idempotency-Key`), allocates a gap-free `GLIM-APP-{intake}-{NNNNN}` under concurrency, records declaration and consent timestamps and the policy text version
- [x] Mailer port with a SendGrid adapter and an SMTP adapter (Mailpit in dev); `notify.send` queue with retries; receipt email in plain text + minimal HTML
- [x] Applicant status page with a timeline; withdraw sets `purge_after`
- [x] Application events written for every transition

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Submit (`POST /applications/:id/submit`, `Idempotency-Key` required):**
  - Accepted only from DRAFT, while the intake is open.
  - Every required answer must be present; otherwise `APPLICATION_INCOMPLETE`, listing each missing field as `section.field`. The photo is checked again too.
  - The minimum age is checked again.
  - The reference number `GLIM-APP-{intake}-{NNNNN}` comes from `application_sequences` under a row lock, in the same transaction, so a failed submit leaves no gap. Five concurrent submits got consecutive numbers.
  - Declaration and consent times and the ADMISSIONS policy version were already recorded when the applicant ticked them (ticket 12).
- **Idempotency (platform):** `idempotency_keys` plus `IdempotencyInterceptor` for any endpoint marked `idempotent`.
  - The same key and request replays the stored response (`idempotent-replayed: true`).
  - A different request with the same key gives `IDEMPOTENCY_KEY_REUSED`; a request still running gives `IDEMPOTENCY_IN_PROGRESS`.
  - Keys last 48 h. The deviation is recorded in the implementation notes.
- **Notifications (new module):** a `notifications` row, with `notify.send` enqueued in the submit transaction.
  - The worker emails the receipt in plain text plus minimal HTML, linking to `/application`. It goes to the application's correspondence email.
  - Bounced, complained or inactive users are suppressed. A failed send retries through the queue.
  - The Mailer port and its SendGrid/SMTP adapters were already in place (ticket 04).
- **Withdraw (`POST /applications/:id/withdraw`):** allowed from DRAFT, SUBMITTED, UNDER_REVIEW or ADMITTED. It sets `withdrawn_at` and `purge_after` = now + `purgeAfterMonths` (12). The applicant may then apply again.
- **Events:** every transition writes `application_events`, an audit row and a domain event. The application carries its `timeline`.
- **Web:**
  - The wizard ends with "Review and submit": it lists missing answers with links to their sections, saves pending changes before submitting, and reuses one Idempotency-Key per attempt.
  - The `/application` status page shows the reference number, the status, a timeline and a two-step withdraw. "My application" links there.
- **Connection-pool deadlock:** reads made inside a transaction (policies, settings, file checks) now use that transaction's connection.
- **Tests:**
  - API: incomplete, missing key, replay and reuse, receipt email (INV-15 sentinel absent from the email, notifications and audit), concurrent numbering, withdraw.
  - Authz: the two new endpoints for every persona.
  - Playwright: the full journey to submit, the reference number on the status page, and the receipt delivered by the in-process worker.
