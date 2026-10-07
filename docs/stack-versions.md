# Stack versions

Pinned at scaffold (TRD §4.4). Every dependency uses an exact version in its `package.json`; the
lockfile is authoritative. When you add or upgrade a dependency, update this table in the same change.

## Notes

- **TypeScript 6.0**, not 7.x: `typescript-eslint` 8.x supports TypeScript `<6.1`.
- **NestJS 12** is ESM-only, so the whole workspace is ESM (`"type": "module"`).
- Workspace packages export their TypeScript sources directly; apps are bundled for production.
- pnpm 12 records approved install scripts under `allowBuilds` in `pnpm-workspace.yaml`.

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

## Services (local compose and Testcontainers)

| Image | Tag |
|---|---|
| postgres | 18 |
| minio/minio | latest (dev only) |
| axllent/mailpit | latest (dev only) |
