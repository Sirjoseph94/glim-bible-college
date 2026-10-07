# 01: Monorepo and CI skeleton

**What to build:** A developer can clone the repo, run one install and one dev command, and get a green CI run. The workspace and the shared packages that every later ticket builds on exist (TRD §4.2–4.4, §5.1, §5.8).

**Blocked by:** None (can start immediately).

**Status:** done

- [x] pnpm workspace + Turborepo with the apps (api, worker, web) and packages (contracts, shared, db, telemetry, modules, integrations) laid out per TRD §4.2
- [x] Strict TypeScript, ESLint (no floating promises), Prettier, Conventional Commits, and dependency-cruiser rules from TRD §4.3 enforced by `pnpm -w deps:check`
- [x] Local Docker compose starts Postgres 18, MinIO and Mailpit
- [x] `shared` provides ids (UUIDv7), an injectable Clock, Result/errors, a Zod config loader (the only reader of `process.env`), cursor pagination, exact decimal helpers, and timezone formatting (viewer zone + Lagos alongside), each with unit/property tests
- [x] `contracts` provides the enum and error-code scaffolding (Appendix D) and queue/event name registries
- [x] GitHub Actions runs install, lint, typecheck, deps:check and unit tests; all green
- [x] Pinned versions recorded in `docs/stack-versions.md`; the root `CLAUDE.md` gains the TRD Appendix E additions

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-07).**
- **TypeScript:** pinned to 6.0.3, because typescript-eslint 8 supports TypeScript below 6.1.
- **ESM:** the whole workspace is ESM, because NestJS 12 is ESM-only.
- **MinIO image:** MinIO no longer publishes official images, so compose uses `bitnamilegacy/minio`.
- **Postgres port:** the compose host port is overridable with `GLIM_PG_PORT`.
- **Verification:** the compose stack was verified healthy (Postgres 18, MinIO, Mailpit).
