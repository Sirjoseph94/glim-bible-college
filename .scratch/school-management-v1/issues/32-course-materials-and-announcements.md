# 32: Course materials and announcements

**What to build:** Lecturers publish files, links and text materials (optionally on a schedule) and post announcements; enrolled students read and download them (TRD §14.1).

**Blocked by:** 13 (Passport photo upload); 19 (Open registration: compulsory courses auto-registered)

**Status:** ready-for-agent

- [ ] Materials FILE/LINK/TEXT with section labels, positions, `publish_at`, and visibility
- [ ] Markdown sanitized with an allow-list (XSS corpus test)
- [ ] Material files reuse the file service (≤ 100 MB, resumable multipart above 8 MB)
- [ ] Announcements per offering, pinned; in-app notification on publish
- [ ] Completed-but-active students keep read access (test)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
