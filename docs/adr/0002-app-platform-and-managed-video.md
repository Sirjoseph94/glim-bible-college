# App Platform hosting with Cloudflare Stream for video

> **Video provider superseded by [ADR-0003](0003-video-delivery-cost.md)** (7 Oct 2026): recordings are now hosted on GLIM's YouTube channel as unlisted videos. The hosting parts of this ADR (App Platform, Managed PG, Spaces, SendGrid, no self-hosted transcoding) still stand.

The original spec ran on DigitalOcean droplets because its self-hosted ffmpeg pipeline needed more disk and longer-running jobs than App Platform allows (about 2 GiB of temporary disk, and a restart on every deploy). GLIM has a single system admin and no devops staff, so we run the app and Managed PostgreSQL on **DigitalOcean App Platform**, and hand recording transcoding, storage and protected playback to a managed video service. The owner chose **Cloudflare Stream** on 7 October 2026; Bunny Stream was the alternative considered.

## Consequences

- The spec's ffmpeg ladder, Cloudflare R2, `media-edge` Worker and media droplets are removed. The worker uploads recordings to Stream over TUS. Playback uses signed URLs (`requireSignedURLs`), with tokens self-signed by the app with a Stream signing key after its entitlement check, so playback makes no Stream API call in the request path.
- **Cost grows with the archive.** Stream bills per minute stored and per minute delivered, and recordings are kept indefinitely (no 180-day purge). Each year of recordings adds roughly $240–360 a month in storage at list prices when this was written. The owner accepted this. The ops page tracks minutes stored and the projected bill, with an alert threshold. An archive policy (export originals to Spaces, then delete them from Stream) is the lever if the cost becomes a problem, and would be a new decision.
- Spike S-V1 verifies Stream's specifics before the adapter is finished: lowest rendition, audio-only, MP4 download, TUS from the worker, webhook signing and Lagos latency. If Stream has no audio-only rendition, a light App Platform worker job extracts the audio track (~18 MB/hour) into Spaces.
- Non-video files (materials, submissions, passport photos) are stored in DigitalOcean Spaces. Email goes through SendGrid. App Platform logs/alerts and encrypted environment variables replace the self-hosted Grafana stack and sops/age.
