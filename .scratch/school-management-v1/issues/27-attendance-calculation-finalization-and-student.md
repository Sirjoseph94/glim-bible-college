# 27: Attendance calculation, finalization and student view

**What to build:** Attendance records are computed from roll call (in person or online), finalized when the class ends, locked after 7 days, and students can see their own attendance (TRD §12.5–12.6).

**Blocked by:** 26 (Roll call)

**Status:** ready-for-agent

- [ ] Pure `computeAttendance` passes every applicable Appendix C vector, including V11–V14 and an online-mark equivalent of V1
- [ ] Persistence writes only computed fields and never the virtual `status` column; advisory lock per meeting; idempotent
- [ ] Finalize on End or tick; recompute allowed until the lock; `attendance.finalized` event
- [ ] Student attendance view per course; Lecturer per-meeting attendance view

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
