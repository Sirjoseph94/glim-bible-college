# 13: Passport photo upload

**What to build:** An applicant uploads a passport photo from their phone; it is shrunk in the browser, stored privately in Spaces, and shown back to them (TRD §14.1 files).

**Blocked by:** 12 (Applicant Google sign-in and application draft)

**Status:** ready-for-agent

- [ ] File service: presigned upload to Spaces/MinIO, complete step with a size check, authorized download as a 302 to a 5-minute presigned URL
- [ ] Per-purpose MIME allow-list and size caps (passport photo ≤ 2 MB)
- [ ] Client-side crop to the passport ratio and downscale to ≤ 600 px / ≤ 300 KB
- [ ] Only the owner and admissions staff can fetch the photo (deny tests)
- [ ] Works on a throttled mobile connection (Playwright)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
