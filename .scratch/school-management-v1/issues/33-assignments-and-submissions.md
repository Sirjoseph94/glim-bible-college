# 33: Assignments and submissions

**What to build:** Lecturers set assignments with due dates, cutoffs and late rules; students submit files or text (resubmitting until the cutoff); Lecturers grade with feedback (TRD §14.2).

**Blocked by:** 32 (Course materials and announcements)

**Status:** ready-for-agent

- [ ] Assignment create/publish backed by an ASSIGNMENT assessment created atomically
- [ ] Submissions with attempts ≤ max, server-side late flag, cutoff enforcement (`SUBMISSION_CLOSED`)
- [ ] Draft autosave for text submissions; files ≤ 20 MB
- [ ] Grading screen with feedback; grade writes are audited (gradebook display comes in ticket 35)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
