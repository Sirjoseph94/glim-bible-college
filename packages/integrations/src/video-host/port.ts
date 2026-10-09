/**
 * Where course videos are hosted (TRD §13.1, ADR-0003): unlisted videos on GLIM's YouTube
 * channel. Domain-neutral types only; modules import this file, never an adapter (INV-3).
 */
export type VideoCheckStatus = "AVAILABLE" | "PRIVATE_OR_RESTRICTED" | "NOT_FOUND";

export interface VideoCheck {
  status: VideoCheckStatus;
  title?: string;
  /** The uploading channel's URL, as the host reports it. */
  channelUrl?: string;
  thumbnailUrl?: string;
}

export interface ServiceCheck {
  reachable: boolean;
  detail: string | null;
  channels: { url: string; resolves: boolean; detail: string | null }[];
}

export interface VideoHost {
  readonly name: "youtube_link" | "youtube_api" | "fake";
  /** The video id in a watch, short-link, live or embed URL; null for anything else. */
  parseUrl(url: string): { videoId: string } | null;
  /** Whether the host serves the video. Throws `VideoHostUnavailableError` if it can't tell. */
  checkVideo(videoId: string): Promise<VideoCheck>;
  /**
   * The ops check (TRD §15.3): whether the host answers at all, and whether each configured
   * channel URL resolves. Never throws; problems are reported in the result.
   */
  checkService(channelUrls: string[]): Promise<ServiceCheck>;
  /** The privacy-enhanced embed and thumbnail URLs (pure). */
  embed(
    videoId: string,
    opts: { startSeconds?: number },
  ): { embedUrl: string; thumbnailUrl: string };
}

/** The host couldn't be asked (network failure, 5xx, rate limit): try again later. */
export class VideoHostUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VideoHostUnavailableError";
  }
}

export const VIDEO_HOST = Symbol.for("glim.VideoHost");

const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

/**
 * YouTube URL parsing shared by the YouTube adapters and the fake: `watch?v=`, `youtu.be/`,
 * `/live/`, `/embed/` (also on youtube-nocookie.com). Playlists, Shorts and channels are refused.
 */
export function parseYouTubeUrl(input: string): { videoId: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  let id: string | null | undefined = null;
  if (host === "youtu.be") id = segments.length === 1 ? segments[0] : null;
  else if (HOSTS.has(host)) {
    if (segments.length === 1 && segments[0] === "watch") id = url.searchParams.get("v");
    else if (segments.length === 2 && (segments[0] === "live" || segments[0] === "embed"))
      id = segments[1];
  } else if (host === "www.youtube-nocookie.com" || host === "youtube-nocookie.com") {
    if (segments.length === 2 && segments[0] === "embed") id = segments[1];
  }
  return id !== null && id !== undefined && ID.test(id) ? { videoId: id } : null;
}

/** youtube-nocookie.com embed (rel=0, inline on phones, JS API for resume) and a ~10 KB thumbnail. */
export function youTubeEmbed(
  videoId: string,
  opts: { startSeconds?: number },
): { embedUrl: string; thumbnailUrl: string } {
  const params = new URLSearchParams({ rel: "0", playsinline: "1", enablejsapi: "1" });
  if (opts.startSeconds !== undefined && opts.startSeconds > 0)
    params.set("start", String(Math.floor(opts.startSeconds)));
  return {
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  };
}

/** A channel URL in one canonical form, for comparing with the allowed list in settings. */
export function normaliseChannelUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
    return `https://${host}${u.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return url.trim().toLowerCase();
  }
}
