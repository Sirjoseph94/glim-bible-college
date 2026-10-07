# 15: Admissions review and decision

**What to build:** An Admissions Officer works through a filterable queue, opens an application (marking it Under Review), sees every section including spiritual background, records notes, and admits or rejects. The applicant is emailed (TRD §10.3, INV-15).

**Blocked by:** 14 (Application submit and receipt email)

**Status:** ready-for-agent

- [ ] Queue filters by status, programme, study mode; search by name/reference
- [ ] Detail endpoint returns spiritual background only with `admissions:application:read-sensitive`; it is absent from list payloads, notifications, logs and audit metadata (tests)
- [ ] Decide (`Idempotency-Key`): admit sets `offer_expires_at = decided_at + offer_acceptance_days`; reject sets `purge_after = decided_at + 12 months`
- [ ] Neutral decision emails; the internal note is never sent
- [ ] Unknown referral codes are flagged on the detail view

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
