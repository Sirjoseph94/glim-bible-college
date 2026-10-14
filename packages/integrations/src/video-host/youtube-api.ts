import { Readable } from "node:stream";
import {
  ChannelAuthError,
  ChannelQuotaError,
  VideoHostUnavailableError,
  type ChannelApi,
  type ChannelCredentials,
  type ChannelInfo,
  type ProcessingStatus,
  type UploadInput,
  type VideoHost,
} from "./port";
import { YouTubeLinkHost } from "./youtube-link";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface YouTubeEndpoints {
  authorize: string;
  token: string;
  api: string;
  upload: string;
}

export const YOUTUBE_ENDPOINTS: YouTubeEndpoints = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  api: "https://www.googleapis.com/youtube/v3",
  upload: "https://www.googleapis.com/upload/youtube/v3",
};

/** Upload, and edit/delete the channel's videos (Appendix A.4 step 5). */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
];

/** YouTube's "Education" category. */
const EDUCATION = "27";
const SKEW_MS = 5 * 60_000;

/** `PT1H2M3S` → milliseconds. */
export function isoDurationMs(value: string): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (m === null) return null;
  const [, d, h, min, s] = m;
  return Math.round(
    ((Number(d ?? 0) * 24 + Number(h ?? 0)) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0)) * 1000,
  );
}

/**
 * The integration-slice adapter (TRD §13.1): oEmbed link checks as in v1, plus acting as GLIM's
 * channel through the YouTube Data API v3 with the channel owner's OAuth grant. Uploads are
 * resumable, streamed from the source in one request (`privacyStatus=unlisted`,
 * `selfDeclaredMadeForKids=false`). Tokens are cached per grant and never logged.
 */
export class YouTubeApiHost implements VideoHost {
  readonly name = "youtube_api" as const;
  readonly channelApi: ChannelApi;
  private readonly endpoints: YouTubeEndpoints;
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly links: YouTubeLinkHost;

  constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      endpoints?: Partial<YouTubeEndpoints>;
      fetch?: FetchLike;
      now?: () => number;
    },
  ) {
    const fetchImpl = options.fetch;
    this.links = new YouTubeLinkHost(
      fetchImpl === undefined ? undefined : (url, init) => fetchImpl(url, init),
    );
    this.endpoints = { ...YOUTUBE_ENDPOINTS, ...options.endpoints };
    this.channelApi = {
      authorizationUrl: (input) => this.authorizationUrl(input),
      exchangeCode: (input) => this.exchangeCode(input),
      channel: (credentials) => this.channelOf(credentials),
      upload: (credentials, input) => this.upload(credentials, input),
      getProcessing: (credentials, videoId) => this.getProcessing(credentials, videoId),
      updateMetadata: (credentials, videoId, input) =>
        this.updateMetadata(credentials, videoId, input),
      deleteVideo: (credentials, videoId) => this.deleteVideo(credentials, videoId),
    };
  }

  parseUrl(url: string) {
    return this.links.parseUrl(url);
  }

  embed(videoId: string, opts: { startSeconds?: number }) {
    return this.links.embed(videoId, opts);
  }

  checkVideo(videoId: string) {
    return this.links.checkVideo(videoId);
  }

  checkService(channelUrls: string[]) {
    return this.links.checkService(channelUrls);
  }

  private get fetchImpl(): FetchLike {
    return this.options.fetch ?? fetch;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private authorizationUrl(input: { redirectUri: string; state: string }): string {
    const url = new URL(this.endpoints.authorize);
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: input.redirectUri,
      response_type: "code",
      scope: YOUTUBE_SCOPES.join(" "),
      access_type: "offline",
      // Always ask again, so Google always returns a refresh token.
      prompt: "consent",
      include_granted_scopes: "true",
      state: input.state,
    }).toString();
    return url.toString();
  }

  private async tokenRequest(form: Record<string, string>): Promise<{
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  }> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoints.token, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
          ...form,
        }).toString(),
      });
    } catch (error) {
      throw new VideoHostUnavailableError("Google couldn't be reached.", { cause: error });
    }
    if (res.status === 400 || res.status === 401) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      throw new ChannelAuthError(
        `Google refused the channel's grant (${typeof body.error === "string" ? body.error : String(res.status)}). Connect the channel again.`,
      );
    }
    if (!res.ok) throw new VideoHostUnavailableError(`Google answered ${String(res.status)}.`);
    return (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };
  }

  private async accessToken(credentials: ChannelCredentials, fresh = false): Promise<string> {
    const cached = this.tokens.get(credentials.refreshToken);
    if (!fresh && cached !== undefined && cached.expiresAt - SKEW_MS > this.now())
      return cached.token;
    const body = await this.tokenRequest({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    });
    this.tokens.set(credentials.refreshToken, {
      token: body.access_token,
      expiresAt: this.now() + body.expires_in * 1000,
    });
    return body.access_token;
  }

  /** An API call as the channel: one token refresh on 401; errors mapped to the port's. */
  private async call(
    credentials: ChannelCredentials,
    url: string,
    init: RequestInit & { accept?: number[] } = {},
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken(credentials, attempt > 0);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          ...init,
          headers: {
            ...(init.headers as Record<string, string>),
            authorization: `Bearer ${token}`,
          },
        });
      } catch (error) {
        throw new VideoHostUnavailableError("YouTube couldn't be reached.", { cause: error });
      }
      if (res.ok || init.accept?.includes(res.status) === true) return res;
      if (res.status === 401 && attempt === 0) {
        await res.body?.cancel();
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; errors?: { reason?: string }[] };
      };
      const reason = body.error?.errors?.[0]?.reason ?? "";
      const message = (body.error?.message ?? `YouTube answered ${String(res.status)}.`).slice(
        0,
        300,
      );
      if (reason === "quotaExceeded" || reason === "uploadLimitExceeded")
        throw new ChannelQuotaError(message);
      if (res.status === 401 || res.status === 403) throw new ChannelAuthError(message);
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new VideoHostUnavailableError(message, {
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterMs: retryAfter * 1000 }
          : {}),
      });
    }
  }

  private async channelOf(credentials: ChannelCredentials): Promise<ChannelInfo> {
    const res = await this.call(
      credentials,
      `${this.endpoints.api}/channels?part=snippet&mine=true`,
    );
    const body = (await res.json()) as { items?: { id: string; snippet?: { title?: string } }[] };
    const channel = body.items?.[0];
    if (channel === undefined)
      throw new ChannelAuthError("That Google account has no YouTube channel.");
    return {
      id: channel.id,
      title: channel.snippet?.title ?? "",
      url: `https://www.youtube.com/channel/${channel.id}`,
    };
  }

  private async exchangeCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<{ refreshToken: string; channel: ChannelInfo }> {
    const body = await this.tokenRequest({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    });
    if (body.refresh_token === undefined)
      throw new ChannelAuthError("Google didn't grant offline access. Try connecting again.");
    const credentials = { refreshToken: body.refresh_token };
    this.tokens.set(body.refresh_token, {
      token: body.access_token,
      expiresAt: this.now() + body.expires_in * 1000,
    });
    return { refreshToken: body.refresh_token, channel: await this.channelOf(credentials) };
  }

  private async upload(
    credentials: ChannelCredentials,
    input: UploadInput,
  ): Promise<{ videoId: string }> {
    // 1. Start a resumable session with the metadata.
    const start = await this.call(
      credentials,
      `${this.endpoints.upload}/videos?uploadType=resumable&part=snippet,status`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(input.sizeBytes),
          "x-upload-content-type": input.mime,
        },
        body: JSON.stringify({
          snippet: {
            title: input.title.slice(0, 100),
            description: input.description.slice(0, 5000),
            categoryId: EDUCATION,
          },
          status: {
            privacyStatus: "unlisted",
            selfDeclaredMadeForKids: false,
            embeddable: true,
          },
        }),
      },
    );
    await start.body?.cancel();
    const session = start.headers.get("location");
    if (session === null) throw new VideoHostUnavailableError("YouTube gave no upload session.");
    // 2. Stream the bytes in one request (the session URL authorizes it).
    let res: Response;
    try {
      res = await this.fetchImpl(session, {
        method: "PUT",
        headers: { "content-type": input.mime, "content-length": String(input.sizeBytes) },
        body: Readable.toWeb(input.body) as ReadableStream<Uint8Array>,
        duplex: "half",
      });
    } catch (error) {
      throw new VideoHostUnavailableError("The upload to YouTube was interrupted.", {
        cause: error,
      });
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; errors?: { reason?: string }[] };
      };
      if (body.error?.errors?.[0]?.reason === "uploadLimitExceeded")
        throw new ChannelQuotaError(body.error.message ?? "Upload limit reached.");
      throw new VideoHostUnavailableError(
        `YouTube refused the upload (${String(res.status)}): ${body.error?.message ?? ""}`.trim(),
      );
    }
    const body = (await res.json()) as { id?: string };
    if (body.id === undefined) throw new VideoHostUnavailableError("YouTube returned no video id.");
    return { videoId: body.id };
  }

  private async getProcessing(
    credentials: ChannelCredentials,
    videoId: string,
  ): Promise<ProcessingStatus> {
    const res = await this.call(
      credentials,
      `${this.endpoints.api}/videos?part=processingDetails,contentDetails,status,snippet&id=${encodeURIComponent(videoId)}`,
    );
    const body = (await res.json()) as {
      items?: {
        processingDetails?: { processingStatus?: string };
        contentDetails?: { duration?: string };
        status?: { uploadStatus?: string };
        snippet?: { thumbnails?: { medium?: { url?: string } } };
      }[];
    };
    const video = body.items?.[0];
    if (video === undefined) return { state: "FAILED", durationMs: null, thumbnailUrl: null };
    const processing = video.processingDetails?.processingStatus;
    const upload = video.status?.uploadStatus;
    const state =
      processing === "failed" ||
      processing === "terminated" ||
      upload === "failed" ||
      upload === "rejected" ||
      upload === "deleted"
        ? "FAILED"
        : processing === "succeeded" || upload === "processed"
          ? "SUCCEEDED"
          : "PROCESSING";
    const duration = video.contentDetails?.duration;
    return {
      state,
      durationMs: duration === undefined ? null : isoDurationMs(duration),
      thumbnailUrl: video.snippet?.thumbnails?.medium?.url ?? null,
    };
  }

  private async updateMetadata(
    credentials: ChannelCredentials,
    videoId: string,
    input: { title: string; description?: string | undefined },
  ): Promise<void> {
    const res = await this.call(credentials, `${this.endpoints.api}/videos?part=snippet`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: videoId,
        snippet: {
          title: input.title.slice(0, 100),
          description: (input.description ?? "").slice(0, 5000),
          categoryId: EDUCATION,
        },
      }),
    });
    await res.body?.cancel();
  }

  private async deleteVideo(credentials: ChannelCredentials, videoId: string): Promise<void> {
    const res = await this.call(
      credentials,
      `${this.endpoints.api}/videos?id=${encodeURIComponent(videoId)}`,
      { method: "DELETE", accept: [404] },
    );
    await res.body?.cancel();
  }
}
