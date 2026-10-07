# 41: Transcript requests, issue and public verification

**What to build:** Students request unofficial (auto-issued) or official transcripts; the Registrar approves and issues them with a serial number and hash; anyone can verify a transcript's status at a public page (TRD §14.7, AC-14).

**Blocked by:** 39 (Semester results, broadsheet and legacy results import)

**Status:** ready-for-agent

- [ ] Requests: unofficial auto-issue (5/day limit), official needs approval; reject with a reason
- [ ] Issue (`Idempotency-Key`): canonical snapshot JSON (Matric Number, semesters, GPA/CGPA, award + class if conferred, legend), SHA-256, serial `GLIM/TR/{YYYY}/{NNNNN}`, 16-char verification code
- [ ] Official requires approved/published semesters (`TRANSCRIPT_NOT_ISSUABLE`); unofficial marks unapproved semesters Provisional
- [ ] Transcripts immutable except status (trigger)
- [ ] `verify_transcript(code)` SQL function and the public `/verify/:code` page showing only minimal fields; rate-limited
- [ ] Hash stable for identical input and changes when any field changes

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
