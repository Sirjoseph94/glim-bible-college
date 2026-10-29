# 02: Google adapter

**What to build:** `GoogleMeetProvider` and its Google client (TRD §11.3, §11.7; WP-MEET-2) plus `FakeGoogleServer`, passing the ticket-01 contract suite.

**Blocked by:** 01

**Status:** done

- [x] DWD JWT-bearer token minting with `jose`; per `(hostEmail, scopes)` cache until 5 min before expiry; tokens never logged
- [x] Meet v2 (spaces create/patch/get/endActiveConference, members, conferenceRecords, participants, participantSessions, recordings), Drive v3 (get, alt=media with Range, trash, about), Workspace Events v1 subscriptions, Pub/Sub REST pull/ack
- [x] `GoogleRateLimiter` over `rl_acquire` (create 8/80, write 80/800, read 480/4800 per min; per-user and per-project) with a max wait that throws `RateLimitWaitError` (handlers reschedule)
- [x] `withGoogleRetry`: 429/5xx/network full-jitter (1 s base, 60 s cap, 5 tries, Retry-After), 401 refresh once, 403 `GooglePermanentError`, 404 on Drive `SourceMissingError`
- [x] Circuit breaker per host account (5 failures in 30 s; half-open every 30 s), state readable for the status page
- [x] `FakeGoogleServer` (in-process HTTP) used by the contract suite

**Spec:** `.scratch/google-integration/spec.md`

## Comments

**Implemented (2026-10-13).**
- `integrations/google`: `ServiceAccountTokens` (JWT-bearer via `jose`, cache until 5 min before expiry), `GoogleClient` (retry taxonomy, 401 refresh once, limiter, per-host breaker), `GoogleRateLimiter` over `rl_acquire` (`bucketAcquire` in `@glim/db`), `CircuitBreaker`, `GoogleMeetProvider` (Meet v2, Drive v3, Workspace Events v1, Pub/Sub v1 REST).
- `FakeGoogleServer` serves the same `MeetWorld` over HTTP; the ticket-01 contract suite runs against it and the in-memory fake.
- Assumptions pending spikes: Meet's REST API reports no dial-in numbers, so `dialIn` is null from Google (S-02); space members API at `v2/spaces/*/members` (S-03); user-target subscriptions take the host's numeric user id (S-04).
