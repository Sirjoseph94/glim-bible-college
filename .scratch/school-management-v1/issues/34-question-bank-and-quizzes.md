# 34: Question bank and quizzes

**What to build:** Lecturers build quizzes from a course question bank; students take timed quizzes that autosave and auto-submit at the deadline, with automatic grading for objective questions (TRD §14.2).

**Blocked by:** 19 (Open registration: compulsory courses auto-registered)

**Status:** done

- [x] Question bank per course: MCQ single/multi, true/false, short text, essay
- [x] Quiz settings: time limit, attempts, scoring (highest/last/average), open/close, shuffle, answer visibility
- [x] Starting an attempt freezes the question snapshot; server-enforced deadline; autosave idempotent by `seq`; submit idempotent
- [x] `quiz.expire` auto-submits 30 s after the deadline
- [x] Auto-grading; essay manual grading screen
- [x] Playwright: timer expiry on a flaky connection

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Schema** (`0033`): `questions`, `quizzes`, `quiz_questions`, `quiz_attempts` (one in progress per student via a partial unique index; `question_snapshot` frozen at start), `quiz_responses`.
- **Domain:** `assessment/domain/quiz.ts` (`markResponse`, `combineAttempts`, `deadlineFor`, `normaliseAnswer`, `shuffled`) with 21 table tests.
- **API:**
  - Question bank: `GET/POST /course-offerings/:id/questions` (the course's bank).
  - Quizzes: `GET/POST /course-offerings/:id/quizzes` and `GET/PATCH /quizzes/:id`. Creating writes the QUIZ assessment with it, and its maximum is the total points. Then `POST /quizzes/:id/publish`.
  - Attempts: `POST /quizzes/:id/attempts` (start or resume; queues `quiz.expire` in the same transaction), `GET /quizzes/:id/my-attempts`, `GET /quiz-attempts/:id`, `PATCH /quiz-attempts/:id` (autosave idempotent by `seq`), and `POST /quiz-attempts/:id/submit` (idempotent).
  - Marking: `GET /quizzes/:id/attempts` (essays to mark first) and `PUT /quiz-attempts/:id/responses/:questionId`.
- **Worker:** the `quiz.expire` handler.
- **Web:**
  - Lecturer's page → Quizzes: question bank (all five types) and the quiz builder (questions, time limit, attempts, scoring, open/close, shuffle, answer visibility), publish, and "Attempts and essays" (marking).
  - Students: My courses → Quizzes → the quiz page with a countdown on the server's clock, answers autosaved about 1 s after each change, kept offline and resent, auto-submitted at zero, then the result with answers as allowed.
- **Tests:**
  - `quizzes.itest.ts` (13): option checks per type; the bank shared across offerings of the course; total as maximum; refused foreign questions, bad windows and edits to published questions; students see quizzes without questions; snapshot frozen and answers hidden; resume returns the same attempt; expiry job queued; seq idempotence and response checks; marking on submit and idempotent submit; answers after the attempt; essay marking into the gradebook (QUIZ, DRAFT); grace window, `ATTEMPT_EXPIRED`, expire (and its early re-queue) and HIGHEST; attempt limit; only students enrolled now; close cuts the deadline; window not open; AVERAGE.
  - Authz samples for all fourteen endpoints.
  - Playwright (Pixel 7): a Lecturer builds a 1-minute quiz; a student goes offline mid-attempt, the timer expires offline, and the answers count when the connection returns within the grace.
