# 40: Awards and graduation

**What to build:** The Registrar proposes an award, sees any unmet requirements, and confirms it; the student graduates with an award class and certificate number, and stops seeing course recordings (TRD §14.6).

**Blocked by:** 39 (Semester results, broadsheet and legacy results import)

**Status:** ready-for-agent

- [ ] Propose: final CGPA, credits earned vs. all compulsory placements + minimum elective credits, award class; checklist `REQUIREMENTS_NOT_MET`; `NO_AWARD` below 1.00
- [ ] Confirm: `CONFERRED`, `awarded_on`, gap-free certificate number `GLIM/{CERT|DIP}/AWD/{YYYY}/{NNNN}`, programme enrollment COMPLETED, student GRADUATED unless another enrollment is active
- [ ] After graduation, `/videos/:id/play` returns 404 for that student (test); the referral code is kept
- [ ] Registrar awards screen

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
