# 36: Hybrid exams

**What to build:** A Lecturer creates an exam where On-campus students sit a paper exam (scores entered by hand) and Online students take a timed online exam, all in the same gradebook column, with individual exceptions (TRD §14.2, C-34).

**Blocked by:** 35 (Gradebook and grade release)

**Status:** done

- [x] EXAM assessment backed optionally by a quiz with `eligible_study_mode='ONLINE'`
- [x] Online attempt scores scaled to the assessment max and written with `source='QUIZ'`
- [x] Paper scores entered or imported with `source='MANUAL'`; changing the source requires a reason (audited)
- [x] Lecturer can grant an online attempt to an individual On-campus student; others get `NOT_ELIGIBLE_FOR_ONLINE_EXAM`
- [x] Appendix C.2 mixed-source example passes

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Schema** (`0034`): `exam_online_grants` (one per quiz and student).
- **Domain:** `scaleToMax` in `assessment/domain/quiz.ts` (Appendix C.2 and rounding vectors); `exam-scores.ts` (`onlineEligible`, `attemptsScore`) shared by attempts and the gradebook; `switchesPath` for the reason rule.
- **API:**
  - `POST /course-offerings/:id/exams` and `POST /assessments/:id/online-exam`.
  - `GET /quizzes/:id/online-grants` and `PUT`/`DELETE /quizzes/:id/online-grants/:studentId`.
  - `POST /assessments/:id/grades/:studentId/online-score`.
  - Starting an online exam checks eligibility (`NOT_ELIGIBLE_FOR_ONLINE_EXAM`); `my-attempts` has `eligible`.
  - The gradebook shows each exam's online part and students' online scores; quizzes have `pointsTotal`.
- **Web:** exam columns from the gradebook; the online part from the quiz builder; exceptions on the attempts page; "Use the online score" in the grade editor; a paper message for students who aren't eligible.
- **Tests:**
  - Domain: 8 `scaleToMax` cases.
  - `exams.itest.ts` (8): Appendix C.2 (66 on paper and 33/50 online both 66.00, sources MANUAL and QUIZ); the maximum and date survive question changes; one online part, exams only, not by Assistants; eligibility, grants (idempotent, audited), withdrawal keeping a started attempt; grant checks; a paper score surviving an online attempt, switching with a reason both ways, feedback keeping the source; no online score to use; CSV refused over an online score.
  - Authz samples for the six new endpoints.
  - Playwright (Pixel 7): exam column, online part, an exception for an On-campus student, an Online student's scaled score and a paper score in one column.
