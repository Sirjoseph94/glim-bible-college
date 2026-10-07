# 35: Gradebook and grade release

**What to build:** Lecturers see one gradebook per course with weighted columns, enter or import scores, release grades per assessment, and every change is recorded; students see only released grades (TRD §14.2, AC-11).

**Blocked by:** 33 (Assignments and submissions); 34 (Question bank and quizzes)

**Status:** ready-for-agent

- [ ] Gradebook view across assessments and enrolled students
- [ ] Manual grade entry with `If-Match`; CSV grade import; `grades.source` recorded
- [ ] `grade_changes` + audit in the same transaction
- [ ] Release per assessment (`Idempotency-Key`); students see only RELEASED grades
- [ ] Weights validation available for finalization (`WEIGHTS_NOT_100`)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
