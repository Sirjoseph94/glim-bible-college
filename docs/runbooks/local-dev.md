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

## First System Admin

```sh
pnpm --filter @glim/api admin:bootstrap --email you@example.org --name "Your Name"
```

Creates the user with the System Admin role and emails a 7-day invite link (locally it lands in Mailpit at http://localhost:8025). If the email can't be sent, the command prints the link instead. It refuses to run once any System Admin exists; invite everyone else from the app.

## End-to-end tests

`pnpm test:e2e` builds the SPA, starts the API on :4173 against a fresh database (Testcontainers, or `TEST_POSTGRES_URL`), and runs Playwright on a mobile viewport. Emails go to an in-memory mailbox the tests read on :4174.

## Google sign-in

Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` (a Google Cloud OAuth web client, TRD Appendix A.2) to enable "Continue with Google". The authorised redirect URI is `<APP_ORIGIN>/api/v1/auth/google/callback`. Without them, the button is hidden and `/auth/google/start` sends users back to the sign-in page. Tests and the e2e stack use `FakeOidcIssuer` (`packages/integrations/src/oidc/fake-issuer.ts`) instead of Google.
