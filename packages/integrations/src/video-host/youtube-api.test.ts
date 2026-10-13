import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ChannelAuthError, ChannelQuotaError } from "./port";
import { isoDurationMs, YouTubeApiHost } from "./youtube-api";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A scripted Google: answers by URL and method, recording every request. */
function google(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    let body = "";
    if (init.body instanceof ReadableStream) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of init.body as ReadableStream<Uint8Array>) chunks.push(chunk);
      body = Buffer.concat(chunks).toString();
    } else if (typeof init.body === "string") body = init.body;
    const call = { url, method, headers, body };
    calls.push(call);
    const key = Object.keys(routes).find((k) => `${method} ${url}`.startsWith(k));
    return key === undefined
      ? new Response("not found", { status: 404 })
      : (routes[key]?.(call) ?? new Response("", { status: 500 }));
  };
  return { fetch, calls };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });
const token = () => json({ access_token: "at-1", expires_in: 3600 });
const credentials = { refreshToken: "rt-1" };

function host(routes: Parameters<typeof google>[0]) {
  const g = google(routes);
  return {
    ...g,
    host: new YouTubeApiHost({
      clientId: "cid",
      clientSecret: "secret",
      endpoints: {
        api: "https://yt.test/v3",
        upload: "https://up.test/v3",
        token: "https://tok.test",
      },
      fetch: g.fetch,
    }),
  };
}

describe("YouTubeApiHost (channel API)", () => {
  it("uploads unlisted in a resumable session, streaming the body", async () => {
    const t = host({
      "POST https://tok.test": token,
      "POST https://up.test/v3/videos?uploadType=resumable": () =>
        new Response(null, { status: 200, headers: { location: "https://up.test/session/1" } }),
      "PUT https://up.test/session/1": () => json({ id: "abcdefghijk" }),
    });
    const result = await t.host.channelApi.upload(credentials, {
      title: "Hermeneutics, week 3",
      description: "Recorded class",
      body: Readable.from([Buffer.from("video-"), Buffer.from("bytes")]),
      sizeBytes: 11,
      mime: "video/mp4",
    });
    expect(result).toEqual({ videoId: "abcdefghijk" });
    const [, start, put] = t.calls;
    expect(start?.headers).toMatchObject({
      authorization: "Bearer at-1",
      "x-upload-content-length": "11",
      "x-upload-content-type": "video/mp4",
    });
    expect(JSON.parse(start?.body ?? "{}")).toMatchObject({
      status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
      snippet: { title: "Hermeneutics, week 3", categoryId: "27" },
    });
    expect(put?.body).toBe("video-bytes");
  });

  it("reports processing and the duration", async () => {
    const t = host({
      "POST https://tok.test": token,
      "GET https://yt.test/v3/videos": () =>
        json({
          items: [
            {
              processingDetails: { processingStatus: "succeeded" },
              contentDetails: { duration: "PT1H2M3S" },
              status: { uploadStatus: "processed" },
              snippet: { thumbnails: { medium: { url: "https://i.ytimg.com/x.jpg" } } },
            },
          ],
        }),
    });
    expect(await t.host.channelApi.getProcessing(credentials, "abcdefghijk")).toEqual({
      state: "SUCCEEDED",
      durationMs: 3_723_000,
      thumbnailUrl: "https://i.ytimg.com/x.jpg",
    });
  });

  it("caches the access token and refreshes it once on a 401", async () => {
    let first = true;
    const t = host({
      "POST https://tok.test": token,
      "DELETE https://yt.test/v3/videos": () => {
        if (first) {
          first = false;
          return new Response("", { status: 401 });
        }
        return new Response(null, { status: 204 });
      },
    });
    await t.host.channelApi.deleteVideo(credentials, "abcdefghijk");
    await t.host.channelApi.deleteVideo(credentials, "abcdefghijk");
    expect(t.calls.filter((c) => c.url === "https://tok.test")).toHaveLength(2);
  });

  it("maps quota, revoked grants and gone videos", async () => {
    const t = host({
      "POST https://tok.test": token,
      "PUT https://yt.test/v3/videos": () =>
        json(
          { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } },
          { status: 403 },
        ),
      "DELETE https://yt.test/v3/videos": () => new Response("", { status: 404 }),
    });
    await expect(
      t.host.channelApi.updateMetadata(credentials, "abcdefghijk", { title: "x" }),
    ).rejects.toBeInstanceOf(ChannelQuotaError);
    await expect(
      t.host.channelApi.deleteVideo(credentials, "abcdefghijk"),
    ).resolves.toBeUndefined();
    const revoked = host({
      "POST https://tok.test": () => json({ error: "invalid_grant" }, { status: 400 }),
    });
    await expect(revoked.host.channelApi.channel(credentials)).rejects.toBeInstanceOf(
      ChannelAuthError,
    );
  });

  it("asks for offline consent with the upload and manage scopes", () => {
    const url = new URL(
      host({}).host.channelApi.authorizationUrl({ redirectUri: "https://app/cb", state: "s1" }),
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("youtube.upload");
  });
});

describe("isoDurationMs", () => {
  it.each([
    ["PT1H2M3S", 3_723_000],
    ["PT45S", 45_000],
    ["PT10M", 600_000],
    ["P1DT1S", 86_401_000],
    ["nonsense", null],
  ])("%s", (value, ms) => {
    expect(isoDurationMs(value)).toBe(ms);
  });
});
