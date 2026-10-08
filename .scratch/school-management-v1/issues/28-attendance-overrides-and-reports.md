# 28: Attendance overrides and reports

**What to build:** Lecturers override a student's attendance (e.g. Excused) with a reason, which survives recalculation; staff export a per-offering attendance matrix (TRD §12.7, AC-11).

**Blocked by:** 27 (Attendance calculation, finalization and student view)

**Status:** done

- [x] Override and clear endpoints with a reason of at least 5 chars, audited in the same transaction
- [x] Override survives recompute (test)
- [x] `GET /reports/attendance?offeringId=&format=csv|json`: student × meeting matrix with the mode per cell and the policy version
- [x] Deny tests: Assistants and Guest Lecturers can't override

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Overrides:** `POST /class-meetings/:id/attendance/:studentId/override {status, reason ≥ 5}` and `DELETE` (`attendance:record:override`: PRIMARY/CO_LECTURER, Academic and System Admin). Each runs under the meeting's advisory lock, is audited with from/to and the reason, and publishes `attendance.record.overridden`, all in one transaction. Allowed after the lock.
- **Survives recompute:** recompute writes only computed fields; tested at the API level (roll call changes, computed status changes, the EXCUSED override stays).
- **Report:** `GET /reports/attendance?offeringId=&format=json|csv` (`attendance:report:read`) gives a student × meeting matrix with status, mode, late and an override flag per cell, and the policy version per meeting (CSV header). The guard now supports query-parameter resources, so the offering's Lecturers can read it.
- **Web:** the Lecturer attendance page has Change (status + reason) and Undo change per record. Each offering's Class Meetings list has "Download attendance (CSV)".
- **Tests:** `attendance.itest.ts` (+4: override with audit and survival, clear, no record / Assistant / Guest Lecturer refused, JSON and CSV report and who may read it); authz samples for the three endpoints; Playwright: excuse a student from the attendance page.

