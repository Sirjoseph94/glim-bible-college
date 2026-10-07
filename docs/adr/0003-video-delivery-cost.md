# ADR-0003: Host recordings on GLIM's YouTube channel as unlisted videos

**Status:** Accepted (owner, 7 October 2026). Supersedes C-42 (Cloudflare Stream) and the provider choice in ADR-0002.
**Date:** 2026-10-07
**Deciders:** GLIM owner

## Context

ADR-0002 moved video to a managed service so that the single System Admin wouldn't run a transcoding server, and the owner then chose Cloudflare Stream (C-42). Stream bills **per minute stored and delivered**. Because GLIM keeps recordings **indefinitely** (C-24), the bill grows every year, and the owner found it too expensive.

**Workload** (TRD §13.7): about 800–1,200 recorded hours a year, and about 1,700 viewer-hours a month, mostly on Nigerian mobile networks.

**Constraints:**
- One System Admin.
- App Platform hosting.
- Low-bandwidth playback (C-07).
- Recordings may show students' faces and voices.

## Decision

**Host recordings on GLIM's own YouTube channel as unlisted videos.** The app stores each video's id and metadata, shows the embedded player (privacy-enhanced mode) only to entitled viewers, checks videos are still available, and tracks resume progress.

It's delivered in two steps:
- **v1:** staff upload in YouTube Studio and paste the link; the app checks the link via YouTube's public oEmbed endpoint (no API keys).
- **Google integration slice:** Meet recordings are uploaded automatically through the YouTube Data API, after the YouTube API Services audit.

## Options Considered

| Option | Monthly cost (yr 1 → yr 3, list prices from memory) | Access control | Ops for the System Admin | Notes |
|---|---|---|---|---|
| A. Cloudflare Stream | $350–460 → $820–1,180, growing | Strong (signed URLs) | None | Billing per minute stored is the problem |
| B. Bunny Stream | $25–55 → $40–105 | Strong (token auth) | None | Was the cost-optimised recommendation |
| C. Self-hosted open source (ffmpeg + R2 + Worker) | $55–75 → $75–110 | Strong | A server and a pipeline | Fully specified in `docs/archive/TRD-v2.1.md` §12 |
| D. PeerTube / MediaCMS | ~$40–80 | Awkward to tie to LMS enrollment | A second application | Rejected |
| E. MP4 files on Spaces | $5–20 | Strong (presigned) | Low | No adaptive streaming; stalls on mobile |
| **F. YouTube unlisted (chosen)** | **$0** | **Weak: anyone with the link can watch** | Low (upload in Studio) | Excellent adaptive delivery down to 144p |
| G. YouTube private | $0 | Strong, but ≤ 50 named viewers per video, shared manually | Very high | Not practical |
| H. YouTube members-only | — | Paid channel memberships | — | Not applicable |
| I. Google Drive sharing per student | $0 (Workspace storage) | Strong (per-Gmail permissions) | None once automated | Needs the Google integration; weaker low-bandwidth controls |

## Trade-off Analysis

The owner chose zero cost and YouTube's very good adaptive delivery in exchange for:

1. **Link exposure.** Anyone with a link can watch, and a shared link can't be revoked. The app's access rules (e.g. "until the programme ends") control what the app shows, not what YouTube serves.
2. **Privacy.** Class recordings are published on a consumer platform under Google's standard terms. The recording notice must say so (D-08), and the DPIA must cover it (C-41).
3. **Ads** may appear even on a non-monetised channel (S-Y1 observes this).
4. **YouTube's control.** Copyright claims (e.g. worship music) or policy actions can mute or remove videos. The app detects this daily, and the Drive originals are kept (D-07).
5. **No audio-only mode** in the embedded player. The 144p data-saver tip replaces it; an optional Spaces audio file is a later option (D-09).
6. **Automatic upload needs Google's API audit and quota.** Until then, staff upload manually.

Options B (Bunny Stream) and I (Drive sharing) remain the documented paths if access control becomes a requirement. Because the `VideoHost` port isolates the provider, switching is an adapter-plus-migration change, not a redesign.

## Consequences

- **Easier:** no video bill, no transcoding, YouTube's global delivery, simple v1 (paste a link).
- **Harder:** access can't be enforced after a link leaks; the institution depends on YouTube's terms and moderation; consent wording needs care.
- **Revisit when:** a recording containing sensitive student content leaks; YouTube removes videos repeatedly; ads become disruptive; or GLIM needs enforceable access. In any of these cases, move to Option B or I.

## Action Items

1. [x] Update TRD §13 and dependent sections, `docs/decisions.md` (C-43, D-07–D-09) and the v1 spec.
2. [ ] Run spike S-Y1 (oEmbed behaviour, ads, Studio upload role, embed on target phones, API audit path).
3. [ ] System Admin creates the channel per TRD Appendix A.4, with unlisted upload defaults.
4. [ ] Update the recording notice and DPIA (D-08).
5. [ ] Integration slice: apply early for the YouTube API Services audit and the upload quota.
