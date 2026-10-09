# Security checklist

The launch security checks (TRD §21.2 "Security", ticket 46). Each item is enforced by an automated check that runs in CI. A failing check blocks the merge. The check is the evidence; this page says where to find it.

| Item | What is checked | Where | Status (2026-10-09) |
|---|---|---|---|
| CSRF | Writes need the session's CSRF token (`x-csrf-token`). Cross-site writes are refused by `Origin` and `Sec-Fetch-Site`, including to public endpoints that have no token yet | `apps/api/test/auth.itest.ts`: "requires the CSRF header to sign out…", "refuses cross-site writes by Origin and Sec-Fetch-Site" | Green |
| Session fixation and rotation | A new `__Host-` cookie (HttpOnly, Secure, SameSite=Lax) on every sign-in. Sessions expire after 2 h idle or 12 h in total. A password reset revokes existing sessions, and so does erasure | `auth.itest.ts`: "…rotates it on every sign-in", "expires a session after 2 hours idle…", "resets the password once, revokes existing sessions…"; `privacy.itest.ts` (erasure ends sessions) | Green |
| Login lockout | 15 minutes after 5 failures, without revealing the lock; 10 auth requests a minute per client address | `auth.itest.ts`: "locks the account for 15 minutes after 5 failures…", "allows 10 auth requests a minute per client IP…" | Green |
| Upload limits | MIME type and size are enforced. A passport photo is JPEG or PNG up to 2 MB. A file becomes available only once the stored size matches; files are owned by their uploader | `apps/api/test/files.itest.ts`: "accepts only JPEG or PNG, up to 2 MB", "…available once the size checks out"; `materials.itest.ts`: "refuses a file that isn't the adder's own finished upload…" | Green |
| XSS (Markdown) | A corpus of OWASP filter-evasion payloads is rendered safe. Images and unsafe links are dropped | `packages/modules/src/content/markdown.test.ts` (the `XSS` corpus) and `materials.itest.ts` | Green |
| Authorization | Every endpoint with a permission has an allow and a deny sample. Staff are denied with 404 when a resource is involved, otherwise with 403 | `apps/api/test/authz.itest.ts` (fails if an endpoint has no sample) | Green |
| Secrets in the repository | gitleaks scans the full history | CI `checks` job, "Secret scan (gitleaks)". Three reviewed false positives are listed by fingerprint in `.gitleaksignore`: sentinel strings in tests that prove sensitive answers never reach logs | Green (run locally on 2026-10-09: no leaks) |
| Vulnerable dependencies and image | Trivy scans `pnpm-lock.yaml` and the built image, and fails on fixable HIGH or CRITICAL findings | CI `image-scan` job | Green (local runs on 2026-10-09: lockfile 0 findings; image 0 after the fix below) |
| Secrets in logs | Tokens, passwords and spiritual-background answers are never logged | `applications.itest.ts` and `review.itest.ts` (sentinel answers absent from captured logs) | Green |

The first image scan failed, and both causes are fixed in `docker/Dockerfile`:
- The npm bundled with the Node base image carried vulnerable copies of `brace-expansion`, `tar`, `undici` and `ip-address`. Nothing runs npm, so it is removed from the runtime image.
- 41 private-key test fixtures shipped inside third-party packages were sitting in the pnpm store. The store is removed once `node_modules` is linked.

## Not automated

- **Penetration test:** not part of v1. Consider one before the integration slice.
- **Dependency updates:** Trivy blocks known fixable vulnerabilities. Bumping versions stays a manual monthly task (`docs/stack-versions.md`).
