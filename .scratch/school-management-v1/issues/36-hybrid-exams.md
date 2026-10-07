# 36: Hybrid exams

**What to build:** A Lecturer creates an exam where On-campus students sit a paper exam (scores entered by hand) and Online students take a timed online exam, all in the same gradebook column, with individual exceptions (TRD §14.2, C-34).

**Blocked by:** 35 (Gradebook and grade release)

**Status:** ready-for-agent

- [ ] EXAM assessment backed optionally by a quiz with `eligible_study_mode='ONLINE'`
- [ ] Online attempt scores scaled to the assessment max and written with `source='QUIZ'`
- [ ] Paper scores entered or imported with `source='MANUAL'`; changing the source requires a reason (audited)
- [ ] Lecturer can grant an online attempt to an individual On-campus student; others get `NOT_ELIGIBLE_FOR_ONLINE_EXAM`
- [ ] Appendix C.2 mixed-source example passes

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
