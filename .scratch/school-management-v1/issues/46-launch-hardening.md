# 46: Launch hardening

**What to build:** The system meets its SLOs at GLIM's scale under load and failure, passes the security and accessibility checks, and the restore drill is done (TRD §20–21, Appendix A.6).

**Blocked by:** 28 (Attendance overrides and reports); 31 (Video administration and availability checks); 42 (Transcript PDF, delivery, revoke and supersede); 07 (App Platform deployment)

**Status:** ready-for-agent

- [ ] k6 scenarios from TRD §21.4 pass the §20.2 SLOs on staging
- [ ] Failure injection: oEmbed unreachable, worker kill, Postgres restart; no lost jobs
- [ ] Lighthouse CI (LCP ≤ 4 s slow 4G) and axe checks green on key routes
- [ ] Security checklist (CSRF, session rotation, lockout, upload limits, XSS corpus, gitleaks, Trivy) green
- [ ] Restore drill completed and timed in the runbook; launch checklist (Appendix A.6) reviewed

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
