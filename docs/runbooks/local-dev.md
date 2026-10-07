# Local development

## Services

```sh
docker compose -f docker/compose.yaml up -d --wait   # Postgres 18 :5432, MinIO :9000 (console :9001), Mailpit :1025 / UI :8025
pnpm db:migrate
pnpm dev                                             # api :3000, worker, web (Vite) :5173 with /api proxied to :3000
```

If port 5432 is taken, start compose with `GLIM_PG_PORT=5434` and point `DATABASE_URL*` at that port in `.env`.

With no `.env`, every setting defaults to the compose stack (`packages/shared/src/config.ts`). Copy `.env.example` to `.env` to override.

## Integration tests

`pnpm test:integration` starts Postgres 18 and MinIO with Testcontainers. To reuse servers you already run, set these in `.env`:

```sh
TEST_POSTGRES_URL=postgres://<superuser>@localhost:5432/postgres   # needs CREATEROLE/CREATEDB
TEST_S3_ENDPOINT=http://localhost:9000
```

The harness creates the `glim_migrator` and `glim_app` roles, migrates a `glim_template` database once per run, and clones a fresh database from it for each test file.

## The SPA through the API (one origin)

`pnpm build` builds the SPA and copies it into `apps/api/static`, which the API serves at `/`. `pnpm budget:check` enforces the TRD §18.3 bundle budgets.
