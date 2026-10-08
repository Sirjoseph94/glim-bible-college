import {
  parseYouTubeUrl,
  VideoHostUnavailableError,
  youTubeEmbed,
  type VideoCheck,
  type VideoHost,
} from "./port";

/** The channel the fake reports unless told otherwise. */
export const FAKE_CHANNEL_URL = "https://www.youtube.com/@glimbiblecollege";

/**
 * A scriptable `VideoHost` for development and tests (TRD §21.3): every well-formed id is an
 * available video on `FAKE_CHANNEL_URL`, unless `script` says otherwise; `down` makes every check
 * fail as if YouTube were unreachable.
 */
export class FakeVideoHost implements VideoHost {
  readonly name = "fake" as const;
  readonly checked: string[] = [];
  down = false;
  private readonly scripted = new Map<string, VideoCheck>();

  script(videoId: string, check: VideoCheck): this {
    this.scripted.set(videoId, check);
    return this;
  }

  parseUrl(url: string) {
    return parseYouTubeUrl(url);
  }

  embed(videoId: string, opts: { startSeconds?: number }) {
    return youTubeEmbed(videoId, opts);
  }

  checkVideo(videoId: string): Promise<VideoCheck> {
    this.checked.push(videoId);
    if (this.down) return Promise.reject(new VideoHostUnavailableError("Fake YouTube is down."));
    return Promise.resolve(
      this.scripted.get(videoId) ?? {
        status: "AVAILABLE",
        title: `Fake video ${videoId}`,
        channelUrl: FAKE_CHANNEL_URL,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      },
    );
  }
}
