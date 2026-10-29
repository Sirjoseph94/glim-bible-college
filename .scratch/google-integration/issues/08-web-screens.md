# 08: Web screens

**What to build:** The screens for the integration (handoff design system).

**Blocked by:** 03, 05, 07

**Status:** done

- [x] Join: Google account required (link Google), link being prepared (retry), dial-in numbers
- [x] Lecturer: provider status on the card, reprovision; participants review (suggested / unmatched → match to a student)
- [x] Admin: Google integration (wizard, host accounts, test result), YouTube connection; recordings in progress / failed with retry
- [x] Playwright with `LIVE_PROVIDER=fake`

**Spec:** `.scratch/google-integration/spec.md`

## Comments

**Implemented (2026-10-14).**
- Student card: a Google Meet class is joinable while its link is being prepared (the server answers `PROVIDER_NOT_READY` and hurries the space); "Join by phone instead" shows dial-in numbers when Google gives them (none today: S-02). `GOOGLE_ACCOUNT_REQUIRED` already linked to Profile.
- Lecturer card: "Google couldn't create the Meet link" with **Ask Google again** (reprovision), and a note while the link is still to be made; Start uses the provisioned link.
- Attendance page: *In the Google Meet call* (`components/teaching/meet-participants.tsx`): who Meet saw, unresolved first, with **Identify/Change** (a student, a Lecturer (not counted), or "someone not on this course"; "Recognise this Google account in later classes"). REVIEW_REQUIRED has its own wording.
- `/admin/integrations` (Ops → Integrations): Google Meet (state, Admin Console values, Workspace domain, host accounts with user ID, use/stop, subscription state, Test Google and its result) and the YouTube channel (connect through Google's consent, disconnect). Ops failure kinds for recordings and subscriptions. Videos: upload state and **Upload again**.
- Tests: card unit tests (Meet variant); Playwright `integrations.spec.ts` (host account, the YouTube consent round trip). The e2e stack keeps `LIVE_PROVIDER` off: switching the shared server would change every meetings spec (students without Google would get `GOOGLE_ACCOUNT_REQUIRED`), so the participants and Meet card flows are covered by the API integration tests and unit tests, not Playwright.
