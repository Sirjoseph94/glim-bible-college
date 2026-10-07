# 34: Question bank and quizzes

**What to build:** Lecturers build quizzes from a course question bank; students take timed quizzes that autosave and auto-submit at the deadline, with automatic grading for objective questions (TRD §14.2).

**Blocked by:** 19 (Open registration: compulsory courses auto-registered)

**Status:** ready-for-agent

- [ ] Question bank per course: MCQ single/multi, true/false, short text, essay
- [ ] Quiz settings: time limit, attempts, scoring (highest/last/average), open/close, shuffle, answer visibility
- [ ] Starting an attempt freezes the question snapshot; server-enforced deadline; autosave idempotent by `seq`; submit idempotent
- [ ] `quiz.expire` auto-submits 30 s after the deadline
- [ ] Auto-grading; essay manual grading screen
- [ ] Playwright: timer expiry on a flaky connection

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
