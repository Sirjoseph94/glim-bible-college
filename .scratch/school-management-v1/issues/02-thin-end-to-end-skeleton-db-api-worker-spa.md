# 02: Thin end-to-end skeleton: DB, API, worker, SPA

**What to build:** Opening the app in a browser shows a page that displays the institution name read from Postgres through the API, and a background job enqueued in the same transaction runs in the worker. This proves every layer and the low-bandwidth budget gate.

**Blocked by:** 01 (Monorepo and CI skeleton)

**Status:** done

- [x] `db` package: Drizzle on Postgres 18, the `glim_migrator`/`glim_app` roles, the single-row `settings` table, and the custom-SQL migration path working
- [x] `Db.withTx` gives `{db, boss}` sharing one transaction; an integration test shows a rolled-back transaction leaves no job behind (INV-5)
- [x] API shell (NestJS + Fastify) with a Zod pipe, generated OpenAPI, the error envelope, request ids, rate limiting, security headers, and `/healthz` + `/readyz` (DB + pg-boss)
- [x] The API serves the built SPA at `/` and the API at `/api/v1` from one origin
- [x] Worker shell starts pg-boss with `WORKER_ROLE`, `ensureQueues()`, the cron registry, the domain-event dispatcher and graceful SIGTERM; a kill-and-redeliver test passes
- [x] React SPA (Vite, TanStack Router/Query, Tailwind) shows the institution name from `GET /settings`
- [x] Testcontainers helpers boot Postgres 18 + MinIO for integration tests; a queue-drain helper runs jobs to completion inside tests
- [x] `pnpm -w budget:check` enforces TRD §18.3 budgets in CI

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-07).**
- **Public endpoint:** the institution name comes from `GET /api/v1/public/institution` rather than `GET /settings`. The TRD catalogue puts `/settings` behind `identity:policy:manage` (ticket 06), and the login and apply pages need the name before sign-in.
- **Endpoint contracts:** endpoints are declared once in `packages/contracts`. The API routes them with `@Endpoint(spec)` and strips responses through the contract's Zod schema. It also generates OpenAPI 3.1 from those schemas, because nestjs-zod and @nestjs/swagger don't support NestJS 12.
- **Integration tests:** the tests use Testcontainers (Postgres 18 + MinIO) by default. `TEST_POSTGRES_URL` / `TEST_S3_ENDPOINT` reuse local servers instead.
- **Bundle size:** the initial JS is 102 KB gzip, against a 170 KB budget.
