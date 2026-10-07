# 21: CSV imports: students, Lecturers, enrollments

**What to build:** The Academic Admin onboards existing GLIM data by uploading CSVs: a dry run first, then a commit, with a downloadable error file and invites for imported users (TRD §15.2, D-04).

**Blocked by:** 10 (Lecturers, Course Offerings and lecturer assignments)

**Status:** ready-for-agent

- [ ] Templates downloadable per kind; files stored in Spaces
- [ ] Dry run is the default; commit requires an unchanged file hash (`IMPORT_FILE_CHANGED`)
- [ ] STUDENTS (with existing Matric Numbers, study mode, Level, programme), LECTURERS and COURSE_ENROLLMENTS upsert by natural keys in batches of 200 inside transactions, resumable by offset
- [ ] Row-level error CSV; imported users get invites (rate-capped) and referral codes
- [ ] A 5,000-row import completes in under 60 s in CI

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
