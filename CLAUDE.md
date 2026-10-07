# GLIM school management system — agent instructions

Source of truth: docs/TRD.md (v3.0). Domain language: GLOSSARY.md. Decisions: docs/decisions.md and docs/adr/.
If anything conflicts, the TRD wins; if the TRD is ambiguous, stop and ask. For the v1 slice, `.scratch/school-management-v1/spec.md` wins over the TRD.

## Commands

pnpm install · pnpm -w dev · pnpm -w typecheck · pnpm -w lint · pnpm -w deps:check · pnpm -w test · pnpm -w test:integration · pnpm -w test:e2e · pnpm -w budget:check · pnpm -w db:migrate · pnpm -w db:generate

Local services: `docker compose -f docker/compose.yaml up -d` (Postgres 18, MinIO, Mailpit).

## Non-negotiables (TRD §0.2)

Single institution (no tenant key/RLS) · server-side entitlement · no Google/video-provider types outside integrations · correctness in Postgres (incl. room + lecturer exclusion constraints) · enqueue pg-boss jobs in the SAME transaction (no Redis, no outbox) · events are hints · join path DB-only · never publish an unverified video · video bytes never through the API · audit in-transaction · no secrets in repo/logs · exact integer arithmetic for grades/GPA · web budgets in CI · sensitive applicant answers stay in Admissions.

## Workflow

1. Read your WP in §23 + referenced sections + GLOSSARY.md. 2. Contract change first. 3. Tests with the code (incl. deny paths). 4. Custom SQL via `drizzle-kit generate --custom`. 5. Verify library APIs from installed types. 6. Update docs/ if behaviour/config changes.

## Do not

Use drizzle-kit push outside scratch DBs · add Redis or multi-tenancy · call Google or YouTube in the request path (except the link check when a video is added) · return Drive URLs · put business rules in controllers or jobs · use floats for grades · log tokens or spiritual-background answers · say "session" unqualified, "teacher", or "student number" · weaken a budget or invariant to make a test pass.

## Agent skills

### Issue tracker

Issues and specs are tracked as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
