# 14: Application submit and receipt email

**What to build:** An applicant reviews missing fields, types their name to sign, ticks the Statement of Faith and consent, and submits. They get an Application Reference No and a receipt email, and can see their status and withdraw (TRD §10.2–10.3).

**Blocked by:** 13 (Passport photo upload)

**Status:** ready-for-agent

- [ ] Review page lists missing required fields; submit is blocked until complete (`APPLICATION_INCOMPLETE`)
- [ ] Submit is idempotent (`Idempotency-Key`), allocates a gap-free `GLIM-APP-{intake}-{NNNNN}` under concurrency, records declaration and consent timestamps and the policy text version
- [ ] Mailer port with a SendGrid adapter and an SMTP adapter (Mailpit in dev); `notify.send` queue with retries; receipt email in plain text + minimal HTML
- [ ] Applicant status page with a timeline; withdraw sets `purge_after`
- [ ] Application events written for every transition

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
