# meetings-and-exams

**What to build:** Class Meetings within offering dates; exam date; makeup exams; finalization skips makeup students.

**Status:** done

**Spec:** `.scratch/block-teaching/spec.md`

## Comments

**Implemented (2026-10-30).** Covered by `block-teaching.itest.ts` (meetings outside the offering's dates, date moves blocked by meetings, makeup set/remove, finalization skipping a student awaiting a makeup). Not covered by an automated test yet: the online exam window moving to the makeup day (`QuizAttemptsService` `windowFor`).
