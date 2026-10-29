# Launch checklist (TRD Appendix A.6)

This is the review at the end of v1 (ticket 46, 9 October 2026). Each line says what is done and where the evidence is. It also names who signs off what is left. Launch when every line reads **Done** or **Accepted**, with a name and a date.

| # | Item (A.6) | Status | Evidence / what's left | Sign-off |
|---|---|---|---|---|
| 1 | Spikes S-01…S-17 and S-Y1 closed or accepted | **Open** | S-16 is done (`docs/spikes/S-16-react-pdf.md`). S-17 (the VPS deploy, ADR-0004) is written up but needs staging (`docs/spikes/S-17-app-platform.md`). S-Y1 (YouTube) and S-01 (Meet IDs, TRD Appendix B.1) are open in `docs/decisions.md`. The others belong to the Google integration slice: for v1, accept them as "not needed yet". | System Admin + developer |
| 2 | DPAs and terms reviewed: Hostinger, Neon, Cloudflare, Google (Workspace + YouTube), Brevo (C-41), and the public privacy policy and terms of service (`/privacy`, `/terms`, LEGAL-1). The recording notice mentions YouTube (D-08) | **Open** | The processors are listed in `docs/compliance/ropa.md`. The legal review is outside the code. Enter the D-08 recording-notice wording in the settings. | Owner (Registrar / leadership) |
| 3 | NDPC registration status recorded | **Open** | Record it at the top of `docs/compliance/ropa.md`. | Owner |
| 4 | Privacy notice, recording notice and Statement of Faith URL live | **Open** | The app shows whatever the System Admin enters under **Settings**. Enter the live URLs on production. | System Admin |
| 5 | Backups and restore drill done | **Partly done** | The weekly encrypted dump is restored on every integration run (`apps/worker/test/backup.itest.ts`). A local drill was timed on 2026-10-09 (`docs/runbooks/restore.md`, "Drill record"); it found two faults in the dump, now fixed. Still to do: a staging drill of runbook sections A and B with the real `age` key, timed and recorded. | System Admin |
| 6 | Budgets green; load tests green | **Partly done** | The bundle budgets (`pnpm budget:check`) and Lighthouse CI are green: LCP 2.0–2.2 s on slow 4G against a 4 s budget, CLS ≤ 0.03. axe passes on 17 key routes. Failure injection is green (`apps/api/test/resilience.itest.ts`). Still to do: run the k6 scenarios on staging (`load/README.md`) and record the result. | Developer |
| 7 | `docs/decisions.md` defaults D-01…D-09 confirmed | **Open** | All nine are built as defaults "awaiting owner confirmation". | Owner |
| 8 | Runbooks written for the System Admin | **Done for v1** | `docs/runbooks/`: building the server, deploy and rollback, restore, breach, provider outage, local dev. The stuck-recording, `SOURCE_MISSING` and subscription-renewal runbooks belong to the Google integration slice. | System Admin to read |

## Also before launch

- The security checklist is green: `docs/security-checklist.md`.
- The YouTube channel is created with unlisted upload defaults (TRD Appendix A.4, spec "Before launch").
- `BACKUP_AGE_RECIPIENT` is set on production, and the age private key is held offline by two named people (`docs/runbooks/restore.md`).
- An external uptime monitor watches `/readyz`, `/login` and `/apply` (TRD §20.2).
