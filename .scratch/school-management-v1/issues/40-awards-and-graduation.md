# 40: Awards and graduation

**What to build:** The Registrar proposes an award, sees any unmet requirements, and confirms it; the student graduates with an award class and certificate number, and stops seeing course recordings (TRD §14.6).

**Blocked by:** 39 (Semester results, broadsheet and legacy results import)

**Status:** done

- [x] Propose: final CGPA, credits earned vs. all compulsory placements + minimum elective credits, award class; checklist `REQUIREMENTS_NOT_MET`; `NO_AWARD` below 1.00
- [x] Confirm: `CONFERRED`, `awarded_on`, gap-free certificate number `GLIM/{CERT|DIP}/AWD/{YYYY}/{NNNN}`, programme enrollment COMPLETED, student GRADUATED unless another enrollment is active
- [x] After graduation, `/videos/:id/play` returns 404 for that student (test); the referral code is kept
- [x] Registrar awards screen

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-09).**
- **Schema** (`0039`): `awards` (with the requirements checklist) and `award_sequences`.
- **Service** (`AwardsService`): propose (CGPA, credits, class and checklist), confirm (`NO_AWARD`, `REQUIREMENTS_NOT_MET`, gap-free certificate number, enrollment COMPLETED, student GRADUATED unless another enrollment is ACTIVE), candidates and list.
- **API:** `GET /awards/candidates`, `GET /awards`, `POST /programme-enrollments/:id/award/propose`, `POST /awards/:id/confirm`.
- **Web:** Awards for the Registrar.
- **Tests:**
  - `awards.itest.ts` (6): candidates with CGPA (Registrar only); the proposal's figures and checklist with elective credits unmet; `REQUIREMENTS_NOT_MET`; `NO_AWARD` at CGPA 0.00; conferring (number `GLIM/DIP/AWD/2026/0001`, date, enrollment COMPLETED, student GRADUATED, referral code kept, confirm again unchanged, re-propose refused, audit); recordings 404 after graduation; the next number 0002 and a student with another ACTIVE enrollment staying ACTIVE.
  - Authz samples for the four endpoints.
  - Playwright (Pixel 7): the Registrar proposes Bola's award, sees the requirements met and confers it.
