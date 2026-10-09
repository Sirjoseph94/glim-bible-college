import {
  parseYouTubeUrl,
  VideoHostUnavailableError,
  youTubeEmbed,
  type ServiceCheck,
  type VideoCheck,
  type VideoHost,
} from "./port";

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

const OEMBED = "https://www.youtube.com/oembed";
/** A long-lived public video ("Me at the zoo") used only to see that oEmbed answers. */
const PROBE_VIDEO = "jNQXAC9IVRw";
const TIMEOUT_MS = 5000;

/**
 * v1 adapter (TRD §13.1): checks links through YouTube's public oEmbed endpoint. No API key and
 * no Google account. oEmbed answers for public and unlisted videos alike; private ones are 401
 * or 403, removed or unknown ones 404 (or 400 for a malformed id).
 */
export class YouTubeLinkHost implements VideoHost {
  readonly name = "youtube_link" as const;

  constructor(private readonly fetchImpl: Fetch = (url, init) => fetch(url, init)) {}

  parseUrl(url: string) {
    return parseYouTubeUrl(url);
  }

  embed(videoId: string, opts: { startSeconds?: number }) {
    return youTubeEmbed(videoId, opts);
  }

  async checkVideo(videoId: string): Promise<VideoCheck> {
    const watch = `https://www.youtube.com/watch?v=${videoId}`;
    let res: Response;
    try {
      res = await this.fetchImpl(
        `${OEMBED}?${new URLSearchParams({ url: watch, format: "json" }).toString()}`,
        {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
    } catch (error) {
      throw new VideoHostUnavailableError("YouTube couldn't be reached.", { cause: error });
    }
    if (res.status === 401 || res.status === 403) return { status: "PRIVATE_OR_RESTRICTED" };
    if (res.status === 404 || res.status === 400) return { status: "NOT_FOUND" };
    if (!res.ok) throw new VideoHostUnavailableError(`YouTube answered ${String(res.status)}.`);
    let body: { title?: unknown; author_url?: unknown; thumbnail_url?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch (error) {
      throw new VideoHostUnavailableError("YouTube sent an unreadable answer.", { cause: error });
    }
    return {
      status: "AVAILABLE",
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.author_url === "string" ? { channelUrl: body.author_url } : {}),
      ...(typeof body.thumbnail_url === "string" ? { thumbnailUrl: body.thumbnail_url } : {}),
    };
  }

  async checkService(channelUrls: string[]): Promise<ServiceCheck> {
    let reachable = false;
    let detail: string | null = null;
    try {
      const probe = await this.checkVideo(PROBE_VIDEO);
      reachable = true;
      if (probe.status !== "AVAILABLE") detail = "oEmbed answered, but not for a public video.";
    } catch (error) {
      detail = error instanceof Error ? error.message : "YouTube couldn't be reached.";
    }
    const channels = [];
    for (const url of channelUrls) {
      try {
        const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        channels.push({
          url,
          resolves: res.ok,
          detail: res.ok ? null : `YouTube answered ${String(res.status)}.`,
        });
      } catch {
        channels.push({ url, resolves: false, detail: "YouTube couldn't be reached." });
      }
    }
    return { reachable, detail, channels };
  }
}
