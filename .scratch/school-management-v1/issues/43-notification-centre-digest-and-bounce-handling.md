# 43: Notification centre, digest and bounce handling

**What to build:** Every user has an in-app notification list and preferences; non-critical updates arrive as a daily digest; quiet hours are respected; emails stop going to addresses that bounce (TRD §15.1).

**Blocked by:** 14 (Application submit and receipt email)

**Status:** done

- [x] In-app notifications with read state; per-kind in-app/email preferences
- [x] Critical-email policy per TRD §15.1; everything else in a 06:00 Lagos digest; no non-critical email 21:00–06:00 in the recipient's zone
- [x] Times in emails rendered in the recipient's timezone with Lagos alongside
- [x] SendGrid signed Event Webhook → inbox → `users.email_status` set on bounce/dropped/spam report; suppressed sends recorded
- [x] Deduplication per (user, dedupe key)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-09).**
- **Schema** (`0042`): `notification_preferences`, `provider_events`, and the `DIGEST` email status.
- **Contracts:** `NOTIFICATION_KINDS`, `CRITICAL_KINDS` and `QUIET_HOURS`; the notification centre, preferences and SendGrid webhook endpoints; an endpoint `signedWebhook` flag.
- **Notifications service:**
  - the critical-or-digest decision with preferences;
  - recipient time zones at delivery;
  - `digest()` (fan-out by quiet hours, then per person);
  - list, read and preferences;
  - `suppressAddress`.
- **Ops:** `InboxService` (receive into `provider_events` with a job; process bounces, drops and spam reports).
- **Integrations:** SendGrid signature verification.
- **API:** the raw-JSON parser for `/integrations/*`.
- **Worker:** `notify.digest` and `provider-event.process`.
- **Web:** `/notifications` and the nav unread count.
- **Tests:**
  - `notifications.itest.ts` (9):
    - critical emailed at once, the rest DIGEST;
    - email times in New York with Lagos alongside;
    - preferences (email off, critical stays on, unknown kind 404);
    - the centre (order, deep link, unread count, paging, others' notifications untouchable, read-all, hidden kinds);
    - the digest (one email, read ones skipped) and quiet hours (New York held to its 06:00, Lagos sent now, a run in quiet hours sends nothing);
    - the webhook (unsigned and stale refused with nothing stored; bounce → BOUNCED and waiting email SUPPRESSED; repeats ignored; delivered IGNORED; spam report → COMPLAINED).
  - Two earlier expectations moved from NOT_REQUESTED to DIGEST.
  - Playwright (Pixel 7): a student reads notifications, marks them all read and turns an email kind off; critical kinds show "Always".
