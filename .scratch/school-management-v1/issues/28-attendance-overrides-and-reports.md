# 28: Attendance overrides and reports

**What to build:** Lecturers override a student's attendance (e.g. Excused) with a reason, which survives recalculation; staff export a per-offering attendance matrix (TRD §12.7, AC-11).

**Blocked by:** 27 (Attendance calculation, finalization and student view)

**Status:** ready-for-agent

- [ ] Override and clear endpoints with a reason of at least 5 chars, audited in the same transaction
- [ ] Override survives recompute (test)
- [ ] `GET /reports/attendance?offeringId=&format=csv|json`: student × meeting matrix with the mode per cell and the policy version
- [ ] Deny tests: Assistants and Guest Lecturers can't override

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
