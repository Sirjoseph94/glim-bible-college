import {
  ChannelAuthError,
  ChannelQuotaError,
  parseYouTubeUrl,
  VideoHostUnavailableError,
  youTubeEmbed,
  type ChannelApi,
  type ChannelCredentials,
  type ChannelInfo,
  type ProcessingStatus,
  type ServiceCheck,
  type UploadInput,
  type VideoCheck,
  type VideoHost,
} from "./port";

export interface FakeUpload {
  videoId: string;
  title: string;
  description: string;
  bytes: Buffer;
  mime: string;
  deleted: boolean;
}

/**
 * A scriptable channel (TRD §21.3): records uploads; each video reports PROCESSING once, then
 * SUCCEEDED with `durationMs` (or what `processing` scripts for it). `failure` makes the next
 * calls fail as YouTube might.
 */
export class FakeChannel implements ChannelApi {
  readonly uploads = new Map<string, FakeUpload>();
  readonly processing = new Map<string, ProcessingStatus[]>();
  readonly info: ChannelInfo = {
    id: "UCglimfakechannel000000",
    title: "GLIM Online Bible College",
    url: "https://www.youtube.com/channel/UCglimfakechannel000000",
  };
  /** The refresh token `exchangeCode` grants and every call requires. */
  grant = "fake-refresh-token";
  /** What a new upload reports as its duration once processed. */
  durationMs = 3_600_000;
  failure: "unavailable" | "auth" | "quota" | null = null;
  private seq = 0;

  /** Runs a call as YouTube would: failures and a wrong grant become rejections. */
  private run<T>(credentials: ChannelCredentials, fn: () => T): Promise<T> {
    try {
      this.check(credentials);
      return Promise.resolve(fn());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private check(credentials: ChannelCredentials): void {
    if (this.failure === "unavailable")
      throw new VideoHostUnavailableError("Fake YouTube is down.");
    if (this.failure === "quota") throw new ChannelQuotaError("Fake quota exceeded.");
    if (this.failure === "auth" || credentials.refreshToken !== this.grant)
      throw new ChannelAuthError("Fake grant revoked.");
  }

  authorizationUrl(input: { redirectUri: string; state: string }): string {
    const params = new URLSearchParams({ redirect_uri: input.redirectUri, state: input.state });
    return `https://accounts.google.test/consent?${params.toString()}`;
  }

  exchangeCode(input: { code: string }): Promise<{ refreshToken: string; channel: ChannelInfo }> {
    if (input.code !== "good-code") return Promise.reject(new ChannelAuthError("Bad code."));
    return Promise.resolve({ refreshToken: this.grant, channel: this.info });
  }

  channel(credentials: ChannelCredentials): Promise<ChannelInfo> {
    return this.run(credentials, () => this.info);
  }

  async upload(credentials: ChannelCredentials, input: UploadInput): Promise<{ videoId: string }> {
    this.check(credentials);
    const chunks: Buffer[] = [];
    for await (const chunk of input.body) chunks.push(Buffer.from(chunk as Uint8Array));
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== input.sizeBytes)
      throw new VideoHostUnavailableError("The upload was cut short.");
    this.seq++;
    const videoId = `fakeUp${String(this.seq).padStart(5, "0")}`;
    this.uploads.set(videoId, {
      videoId,
      title: input.title,
      description: input.description,
      bytes,
      mime: input.mime,
      deleted: false,
    });
    if (!this.processing.has(videoId))
      this.processing.set(videoId, [
        { state: "PROCESSING", durationMs: null, thumbnailUrl: null },
        {
          state: "SUCCEEDED",
          durationMs: this.durationMs,
          thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        },
      ]);
    return { videoId };
  }

  getProcessing(credentials: ChannelCredentials, videoId: string): Promise<ProcessingStatus> {
    return this.run(credentials, () => {
      const script = this.processing.get(videoId) ?? [];
      const next = script.length > 1 ? script.shift() : script[0];
      return next ?? { state: "FAILED" as const, durationMs: null, thumbnailUrl: null };
    });
  }

  updateMetadata(
    credentials: ChannelCredentials,
    videoId: string,
    input: { title: string; description?: string | undefined },
  ): Promise<void> {
    return this.run(credentials, () => {
      const upload = this.uploads.get(videoId);
      if (upload !== undefined) {
        upload.title = input.title;
        upload.description = input.description ?? "";
      }
    });
  }

  deleteVideo(credentials: ChannelCredentials, videoId: string): Promise<void> {
    return this.run(credentials, () => {
      const upload = this.uploads.get(videoId);
      if (upload !== undefined) upload.deleted = true;
    });
  }
}

/** The channel the fake reports unless told otherwise. */
export const FAKE_CHANNEL_URL = "https://www.youtube.com/@glimbiblecollege";

/**
 * A scriptable `VideoHost` for development and tests (TRD §21.3): every well-formed id is an
 * available video on `FAKE_CHANNEL_URL`, unless `script` says otherwise; `down` makes every check
 * fail as if YouTube were unreachable.
 */
export class FakeVideoHost implements VideoHost {
  readonly name = "fake" as const;
  readonly channelApi = new FakeChannel();
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

  /** Reachable unless `down`; only `FAKE_CHANNEL_URL` resolves. */
  checkService(channelUrls: string[]): Promise<ServiceCheck> {
    return Promise.resolve({
      reachable: !this.down,
      detail: this.down ? "Fake YouTube is down." : null,
      channels: channelUrls.map((url) => {
        const resolves = !this.down && url === FAKE_CHANNEL_URL;
        return { url, resolves, detail: resolves ? null : "YouTube answered 404." };
      }),
    });
  }
}
