# 43: Notification centre, digest and bounce handling

**What to build:** Every user has an in-app notification list and preferences; non-critical updates arrive as a daily digest; quiet hours are respected; emails stop going to addresses that bounce (TRD §15.1).

**Blocked by:** 14 (Application submit and receipt email)

**Status:** ready-for-agent

- [ ] In-app notifications with read state; per-kind in-app/email preferences
- [ ] Critical-email policy per TRD §15.1; everything else in a 06:00 Lagos digest; no non-critical email 21:00–06:00 in the recipient's zone
- [ ] Times in emails rendered in the recipient's timezone with Lagos alongside
- [ ] SendGrid signed Event Webhook → inbox → `users.email_status` set on bounce/dropped/spam report; suppressed sends recorded
- [ ] Deduplication per (user, dedupe key)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
