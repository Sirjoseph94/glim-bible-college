# 46: Launch hardening

**What to build:** The system meets its SLOs at GLIM's scale under load and failure, passes the security and accessibility checks, and the restore drill is done (TRD §20–21, Appendix A.6).

**Blocked by:** 28 (Attendance overrides and reports); 31 (Video administration and availability checks); 42 (Transcript PDF, delivery, revoke and supersede); 07 (App Platform deployment)

**Status:** ready-for-human (the agent's part is done; the staging runs and sign-offs below are left)

- [ ] k6 scenarios from TRD §21.4 pass the §20.2 SLOs on staging. The scenarios are written and smoke-tested; the staging run is left.
- [x] Failure injection: oEmbed unreachable, worker kill, Postgres restart; no lost jobs
- [x] Lighthouse CI (LCP ≤ 4 s slow 4G) and axe checks green on key routes
- [x] Security checklist (CSRF, session rotation, lockout, upload limits, XSS corpus, gitleaks, Trivy) green
- [ ] Restore drill completed and timed in the runbook; launch checklist (Appendix A.6) reviewed. The local drill is done and timed, and the checklist is reviewed. The staging drill and the owners' sign-offs are left.

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Agent part done (2026-10-09); handed to a human for the staging-only steps.**

**Failure injection** (`apps/api/test/resilience.itest.ts`, 4 tests):
- **YouTube unreachable:** playing still works. The availability sweep throws, so it is retried, and marks nothing unavailable.
- **A crashed handler:** its job goes to `retry` with its payload.
- **A rolled-back transaction:** it leaves no job, while a committed one does.
- **Postgres dropping every connection:** requests, `/readyz` and enqueuing recover.

**A real fault, fixed:** the API's pg-boss instance had no `error` listener. A Postgres restart would have thrown an uncaught error and stopped the API. It now logs, in `main.ts` and in `admin:bootstrap`.

**axe** (`apps/web/e2e/wcag.spec.ts`, 4 tests, 17 routes, WCAG 2.1 A/AA on a phone):
- It found sideways-scrolling tables that keyboard users couldn't reach.
- All seven are now focusable, labelled regions.

**Lighthouse CI** (`apps/web/lighthouserc.cjs` and a CI job), local run on the slow-4G profile:
- LCP 2.0–2.2 s, against a 4 s budget.
- CLS ≤ 0.03.

**Security** (`docs/security-checklist.md`):
- Each item is mapped to the tests that enforce it.
- **gitleaks:** CI's existing step was failing on three test sentinel strings. These were reviewed and are listed in `.gitleaksignore`; the scan is now clean.
- **Trivy:** a new CI `image-scan` job; both scans are clean locally. The first image scan failed on two things in `docker/Dockerfile`, both removed from the runtime image:
  - the npm bundled with Node, which had vulnerable dependencies;
  - the pnpm store, which held private-key test fixtures from other people's packages.

**Restore drill:**
- Timed locally at 1.9 s and recorded in `docs/runbooks/restore.md`.
- It found that the weekly dump couldn't be restored:
  - the extensions were missing;
  - without the privileges, the app would have been locked out.
- The fix is in `BackupService`; the runbook command is corrected.
- `backup.itest.ts` now restores a dump on every integration run, and it fails against the old flags.

**k6:**
- `load/` holds the §21.4 scenarios, with the §20.2 SLOs as thresholds, and a README.
- `SMOKE=1` passed against the local stack.

**Launch checklist:** `docs/launch-checklist.md` reviews A.6 line by line.

**Also written:** `docs/runbooks/provider-outage.md`.

**Left for a human (staging or owner):**
1. Run k6 on staging with about 250 seeded students and 50 applicants (`load/README.md`), and record the result.
2. Run the staging restore drill (runbook sections A and B with the real `age` key), timed.
3. Run spike S-17 on staging.
4. Get the A.6 sign-offs: DPAs, NDPC status, live notice URLs, D-01…D-09, and spikes S-01 and S-Y1.
5. Watch the first CI run of the new `image-scan` and `lighthouse` jobs. They were exercised locally with Docker and lhci, not on GitHub's runners.
