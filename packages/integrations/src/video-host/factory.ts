import type { Config } from "@glim/shared/config";
import { FakeVideoHost } from "./fake";
import type { VideoHost } from "./port";
import { YouTubeApiHost } from "./youtube-api";
import { YouTubeLinkHost } from "./youtube-link";

/**
 * The video host for `VIDEO_HOST` (TRD §13.1): link checks by oEmbed (v1), or also acting as
 * the channel through the YouTube Data API (integration slice); the fake for development.
 */
export function createVideoHost(config?: Config): VideoHost {
  if (config?.videoHost === "fake") return new FakeVideoHost();
  if (config?.videoHost === "youtube_api") {
    const { oauthClientId, oauthClientSecret } = config.youtube;
    // loadConfig refuses youtube_api without these; this guards other callers.
    if (oauthClientId === undefined || oauthClientSecret === undefined)
      throw new Error("VIDEO_HOST=youtube_api needs the YouTube OAuth client.");
    return new YouTubeApiHost({ clientId: oauthClientId, clientSecret: oauthClientSecret });
  }
  return new YouTubeLinkHost();
}
