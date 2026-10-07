# Stack versions

Pinned at scaffold (TRD §4.4). Every dependency uses an exact version in its `package.json`; the
lockfile is authoritative. When you add or upgrade a dependency, update this table in the same change.

## Notes

- **TypeScript 6.0**, not 7.x: `typescript-eslint` 8.x supports TypeScript `<6.1`.
- **NestJS 12** is ESM-only, so the whole workspace is ESM (`"type": "module"`).
- Workspace packages export their TypeScript sources directly; apps are bundled for production.
- pnpm 12 records approved install scripts under `allowBuilds` in `pnpm-workspace.yaml`.
- NestJS is used without `emitDecoratorMetadata`: every constructor parameter has an explicit `@Inject(token)`, so the code runs under tsx/esbuild, Vite/oxc and tsdown alike.
- `tsx` is run with `--tsconfig ../../tsconfig.base.json`, because it applies `experimentalDecorators` only to files inside the chosen tsconfig's `include`.
- `nestjs-zod` and `@nestjs/swagger` are not used: they don't support NestJS 12. Endpoints are declared once in `packages/contracts` and the API generates OpenAPI 3.1 from the Zod schemas with `z.toJSONSchema`.

## Runtime and tooling

| Package | Version | Used for |
|---|---|---|
| Node.js | 24 (LTS) | runtime (`.nvmrc`) |
| pnpm | 12.8.1 | package manager |
| turbo | 2.11.7 | task runner |
| typescript | 6.0.3 | language |
| eslint | 10.12.0 | lint |
| typescript-eslint | 8.71.1 | lint |
| prettier | 3.9.9 | format |
| dependency-cruiser | 18.5.0 | `deps:check` (§4.3) |
| @commitlint/cli, config-conventional | 21.2.3 | Conventional Commits |
| simple-git-hooks | 2.14.0 | commit-msg hook |
| vitest | 5.0.3 | unit and integration tests |
| fast-check | 4.10.2 | property tests |
| tsx | 4.23.15 | dev runner |

## Libraries

| Package | Version | Used for |
|---|---|---|
| zod | 4.6.5 | contracts, config |
| luxon | 3.7.2 | timezones |
| uuid | 14.0.2 | UUIDv7 (`newId`) |
| pino | 10.4.0 | logging |
| drizzle-orm | 0.45.3 | ORM (`node-postgres`) |
| drizzle-kit | 0.31.11 | migrations |
| pg / @types/pg | 8.23.1 | Postgres driver |
| pg-boss | 12.37.0 | jobs (schema `pgboss`) |
| @nestjs/core, common, platform-fastify, testing | 12.1.2 | API framework (ESM-only) |
| fastify | 5.12.5 | HTTP server |
| @fastify/static | 10.1.5 | SPA serving (precompressed) |
| @fastify/helmet | 13.1.1 | security headers / CSP |
| @fastify/rate-limit | 11.2.0 | rate limiting |
| @fastify/compress | 9.2.0 | br/gzip |
| reflect-metadata | 0.2.2 | Nest decorators |
| rxjs | 7.8.2 | Nest interceptors |
| react, react-dom | 19.3.0 | SPA |
| @tanstack/react-router | 1.170.41 | routing (code-split) |
| @tanstack/react-query | 5.104.1 | data fetching |
| vite | 8.3.3 | SPA build |
| @vitejs/plugin-react | 6.1.2 | SPA build |
| tailwindcss, @tailwindcss/vite | 4.3.3 | styling |
| testcontainers, @testcontainers/postgresql | 12.2.0 | integration tests |

## Services (local compose and Testcontainers)

| Image | Tag |
|---|---|
| postgres | 18 |
| bitnamilegacy/minio | 2025.7.23 (dev/test only; MinIO no longer publishes official images) |
| axllent/mailpit | latest (dev only) |
