# 38: Course result finalization and student results view

**What to build:** The PRIMARY Lecturer finalizes a course, freezing each student's result; students see their course results immediately and their GPA/CGPA marked Provisional; the Registrar can reopen with a reason (TRD §14.3, C-11).

**Blocked by:** 36 (Hybrid exams); 37 (Grading schemes, award classes and GPA functions)

**Status:** ready-for-agent

- [ ] Finalize (`Idempotency-Key`): weights must total 100; missing grades count as 0 once closed; excused grades renormalized; integer arithmetic; gradebook locked
- [ ] Frozen fields per TRD §14.3 including credits, letter, points, quality points, programme enrollment and semester
- [ ] Reopen (Registrar/System Admin, reason) writes revisions and unlocks
- [ ] Student results page: course results on finalization; provisional GPA/CGPA computed on the fly

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
