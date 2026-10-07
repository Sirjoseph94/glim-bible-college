# 31: Video administration and availability checks

**What to build:** The System Admin manages every video in one screen: replace a link, delete with 7-day restore and a YouTube Studio reminder, and see videos YouTube no longer serves, which are hidden automatically (TRD §13.3, §13.6, AC-19).

**Blocked by:** 30 (Watch recordings with resume)

**Status:** ready-for-agent

- [ ] `/admin/videos` across offerings with filters and YouTube Studio links
- [ ] Replace link (`PUT /videos/:id/youtube-link`) re-checks the link; progress resets if the duration differs by more than 5%
- [ ] Delete → `DELETED` with `delete_after` +7 d; restore within the window; daily purge reminds the System Admin to delete in YouTube Studio
- [ ] Daily `video.availability-check` and manual recheck: unavailable videos become `UNAVAILABLE`, are hidden, and notify the person who added them and the System Admin; a successful recheck restores the prior status

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
