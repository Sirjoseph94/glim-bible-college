# Implementation notes: deliberate deviations from the TRD

Where the build departs from `docs/TRD.md` on purpose, the reason is recorded here. A deviation that changes behaviour the owner cares about goes in `docs/decisions.md` instead.

| Area | TRD says | Built | Why |
|---|---|---|---|
| API client (§18.1) | Typed client generated from OpenAPI | `apps/web/src/api/client.ts` typed directly from the endpoint contracts in `packages/contracts` (types only) | The contracts are the source of the OpenAPI document too, so the types are identical, with no generation step and no Zod in the browser bundle. |
| Frontend kit (§18.1) | shadcn/ui, react-hook-form, vite-plugin-pwa | Plain Tailwind components and native forms; the PWA arrives with offline roll call (ticket 26) | Bundle budget (§18.3); nothing in the early tickets needs them. |
| OpenAPI (§4.4) | Zod → OpenAPI via the Nest ecosystem | `apps/api/src/openapi.ts` builds OpenAPI 3.1 from the contracts with `z.toJSONSchema` | `nestjs-zod` and `@nestjs/swagger` don't support NestJS 12. |
| `Db.withTx(ctx, fn)` (§5.2) | Takes a request context | `withTx(fn)`, plus `withTxResult(fn)`, which rolls back when a use case returns an expected failure (§5.8) | The context (actor, request id) travels as an explicit `AuditActor` argument. |
| Invite/reset tokens (§8.1) | Single-use, stored as SHA-256; no table defined | `auth_tokens` (owner: identity) | The DDL names no home for them. |
| Lockout (§8.1, Appendix D) | Lockout plus uniform errors | A locked account answers exactly like a wrong password; `ACCOUNT_LOCKED` is unused | Distinct lockout replies would reveal which emails have accounts. |
| Applicant sessions (§8.3) | Idle 24 h for applicants | Idle 24 h, absolute 12 h for everyone | As written; the absolute limit still applies. |
| Client IP (§5.4) | Rate limits per IP | `CLIENT_IP_HEADER` (App Platform: `do-connecting-ip`); `X-Forwarded-For` is never trusted | A client can forge `X-Forwarded-For`. |
| Same-origin writes (§19.1) | Check `Origin`/`Sec-Fetch-Site` | A write must carry one of them, and it must match | Public writes (login, reset, invite) have no CSRF token. |
| Job retention (§17.1) | Archive after 7 days, delete after 30 | `deleteAfterSeconds` 30 days | pg-boss 12 has no archive table. |
| `meeting-tick` (§17.2) | A cron with no queue in §17.1 | Queue `meeting.tick` | pg-boss schedules jobs onto a queue. Cron is registered only for queues that have a handler. |
| Mail (§4.4) | `@sendgrid/mail` | SendGrid v3 REST over `fetch` | One request type; no SDK needed. |
| Policies (§6.2) | Eight policy types | v1 edits ATTENDANCE, JOIN_WINDOW, RECORDING, NOTIFICATION, ADMISSIONS and GRADING_DEFAULTS; schemas and defaults in `packages/contracts/src/policies.ts` | GOOGLE_MEET and RETENTION belong to the integration slice. A type with no saved version uses its defaults (version 0). |
| Time library (§4.4) | `luxon` | `Intl.DateTimeFormat` in `packages/shared/src/time.ts` (browser-safe subpath `@glim/shared/time`) | Keeps the browser bundle small. Server-side recurrence (ticket 24) brings its own library. |
