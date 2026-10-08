import type { VideoHost } from "./port";
import { YouTubeLinkHost } from "./youtube-link";

/** v1 hosts videos by link (oEmbed checks); the integration slice adds `YouTubeApiHost`. */
export function createVideoHost(): VideoHost {
  return new YouTubeLinkHost();
}
