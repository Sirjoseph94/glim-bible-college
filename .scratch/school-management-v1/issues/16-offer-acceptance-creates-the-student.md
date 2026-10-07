# 16: Offer acceptance creates the student

**What to build:** An admitted applicant accepts before the deadline and instantly becomes a student with a Matric Number and an active programme enrollment, and gets a welcome email (TRD §10.4, AC-16).

**Blocked by:** 15 (Admissions review and decision)

**Status:** ready-for-agent

- [ ] One transaction: lock the application; `OFFER_EXPIRED` after expiry
- [ ] Create the student (or reuse an existing one, e.g. a Certificate graduate), copying only name, title, gender, date of birth, nationality, phones, address, church and photo; never spiritual background, marital status or occupation
- [ ] Gap-free Matric Number `GLIM/{CERT|DIP}/{YYYY}/{NNNN}` under concurrency (D-01)
- [ ] Get-or-create the cohort; programme enrollment with the active curriculum, entry session, study mode, Level 1
- [ ] Personal referral code ensured; the welcome email shows the Matric Number; the Academic Admin is notified
- [ ] Offer page with an expiry countdown and an "Accept offer" button

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
