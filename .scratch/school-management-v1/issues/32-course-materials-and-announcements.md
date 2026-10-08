# 32: Course materials and announcements

**What to build:** Lecturers publish files, links and text materials (optionally on a schedule) and post announcements; enrolled students read and download them (TRD §14.1).

**Blocked by:** 13 (Passport photo upload); 19 (Open registration: compulsory courses auto-registered)

**Status:** done

- [x] Materials FILE/LINK/TEXT with section labels, positions, `publish_at`, and visibility
- [x] Markdown sanitized with an allow-list (XSS corpus test)
- [x] Material files reuse the file service (≤ 100 MB, resumable multipart above 8 MB)
- [x] Announcements per offering, pinned; in-app notification on publish
- [x] Completed-but-active students keep read access (test)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Schema** (`0031`): `course_materials` (kind-specific field check), `announcements`, and `files.upload_id`.
- **Storage:** multipart on the `ObjectStorage` port (create, presign part, list parts, complete, abort).
- **Files:** the MATERIAL purpose (100 MB; documents, slides, spreadsheets, text, images, audio), restricted to course staff. Uploads above 8 MB are multipart, with `POST /files/:id/resume`; complete joins the parts after checking their sizes.
- **API:**
  - Materials: `GET/POST /course-offerings/:id/materials`, `PATCH/DELETE /course-materials/:id` (If-Match on PATCH; DELETE archives), and `GET /course-materials/:id/download` (302 to a 5-minute URL).
  - Announcements: `GET/POST /course-offerings/:id/announcements` and `PATCH/DELETE /announcements/:id`; posting notifies enrolled students in the app.
  - Reading needs `content:material:read` (E/C students while studying). Managing needs `content:material:manage` / `content:announcement:manage` (Primary, Co-lecturer, Assistant, academic admins).
- **Markdown:** server-rendered and allow-list sanitized; `markdown.test.ts` runs a 40-payload XSS corpus plus formatting cases.
- **Web:** on the Lecturer's page, "Materials and announcements": post (with pin), pin/unpin, delete; add File (upload progress, parts above 8 MB with retry and resume), Link or Text with section, release time and staff-only; remove. Students get Announcements and Materials on My courses, grouped by section, with downloads.
- **Tests:**
  - `materials.itest.ts` (10): add each kind, assistant may add, sanitized HTML; refuses another person's file and a `javascript:` link; student visibility (draft, staff-only, scheduled); COMPLETED student keeps access; non-entitled 404; download for entitled viewers only, and not through the file route; If-Match edit and kind checks; archive; size and MIME caps; multipart interrupt, resume and complete; announcements notify ENROLLED students only, ordering, pin and delete.
  - Authz samples for all nine endpoints.
  - Playwright: a Lecturer posts and adds text, link and file; a student reads them and downloads the file.
