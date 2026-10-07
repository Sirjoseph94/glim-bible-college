# 02: Thin end-to-end skeleton: DB, API, worker, SPA

**What to build:** Opening the app in a browser shows a page that displays the institution name read from Postgres through the API, and a background job enqueued in the same transaction runs in the worker. This proves every layer and the low-bandwidth budget gate.

**Blocked by:** 01 (Monorepo and CI skeleton)

**Status:** ready-for-agent

- [ ] `db` package: Drizzle on Postgres 18, the `glim_migrator`/`glim_app` roles, the single-row `settings` table, and the custom-SQL migration path working
- [ ] `Db.withTx` gives `{db, boss}` sharing one transaction; an integration test shows a rolled-back transaction leaves no job behind (INV-5)
- [ ] API shell (NestJS + Fastify) with a Zod pipe, generated OpenAPI, the error envelope, request ids, rate limiting, security headers, and `/healthz` + `/readyz` (DB + pg-boss)
- [ ] The API serves the built SPA at `/` and the API at `/api/v1` from one origin
- [ ] Worker shell starts pg-boss with `WORKER_ROLE`, `ensureQueues()`, the cron registry, the domain-event dispatcher and graceful SIGTERM; a kill-and-redeliver test passes
- [ ] React SPA (Vite, TanStack Router/Query, Tailwind) shows the institution name from `GET /settings`
- [ ] Testcontainers helpers boot Postgres 18 + MinIO for integration tests; a queue-drain helper runs jobs to completion inside tests
- [ ] `pnpm -w budget:check` enforces TRD §18.3 budgets in CI

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
