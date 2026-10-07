# 17: Offer reminders, lapse and reopen

**What to build:** Admitted applicants get reminders 7 and 2 days before their offer expires; unaccepted offers lapse automatically; an Admissions Officer can reopen a lapsed offer with a reason (TRD §10.3).

**Blocked by:** 16 (Offer acceptance creates the student)

**Status:** ready-for-agent

- [ ] Hourly `admissions.offer-sweep`: reminders deduplicated per offer, lapse at expiry with a lapse email and `purge_after`
- [ ] Reopen-offer sets a new expiry, clears `purge_after`, is audited and requires a reason
- [ ] Tests drive time with the Clock to cover each boundary

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
