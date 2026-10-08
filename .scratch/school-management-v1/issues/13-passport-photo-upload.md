# 13: Passport photo upload

**What to build:** An applicant uploads a passport photo from their phone; it is shrunk in the browser, stored privately in Spaces, and shown back to them (TRD §14.1 files).

**Blocked by:** 12 (Applicant Google sign-in and application draft)

**Status:** done

- [x] File service: presigned upload to Spaces/MinIO, complete step with a size check, authorized download as a 302 to a 5-minute presigned URL
- [x] Per-purpose MIME allow-list and size caps (passport photo ≤ 2 MB)
- [x] Client-side crop to the passport ratio and downscale to ≤ 600 px / ≤ 300 KB
- [x] Only the owner and admissions staff can fetch the photo (deny tests)
- [x] Works on a throttled mobile connection (Playwright)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **File service (new `content` module, `files` table):**
  - `POST /files/uploads` returns a 15-minute presigned PUT, with the content type and length signed, so the bucket refuses any other size.
  - `POST /files/:id/complete` checks the stored size with a HEAD request; only the uploader can complete.
  - `GET /files/:id/download` redirects (302) to a 5-minute presigned GET with `Content-Disposition: attachment`.
  - Bytes never pass through the API.
- **Allow-list:** `PASSPORT_PHOTO` accepts `image/jpeg` or `image/png` up to 2 MB. It's the only purpose so far; others join with their features.
- **Who may download:** the owner, or a holder of the purpose's read permission (passport photos: `admissions:application:read`, so the System Admin and Admissions Officers). Everyone else gets a 404, and anyone signed out a 401. The tests cover every persona.
- **Application:** a "photo" section. A draft accepts only the applicant's own available passport photo, and `applications.photo_file_id` now references `files`.
- **Browser side:** the photo is centre-cropped to 35:45, scaled to at most 600 px and re-encoded as JPEG until it's at most 300 KB. It uploads straight to the bucket with a progress bar, and the draft saves at once.
- **Infrastructure:**
  - CSP `img-src` allows the bucket's origin and `blob:`.
  - `startTestServices()` is shared by the Vitest global setup and the e2e server, which now has a bucket (a MinIO container in CI).
  - The deploy runbook gains the Spaces CORS rule.
- **Playwright:** a 1200×1600 photo uploads over an emulated 200 kbps / 400 ms connection, then reloads from the bucket at 467×600.
