import { describe, expect, it } from "vitest";
import { FakeVideoHost } from "./fake";
import { normaliseChannelUrl, VideoHostUnavailableError, type VideoHost } from "./port";
import { YouTubeLinkHost } from "./youtube-link";

const ID = "dQw4w9WgXcQ";

/** The behaviour every VideoHost shares (contract suite). */
function contract(name: string, make: () => VideoHost) {
  describe(`${name}: contract`, () => {
    const host = make();
    it.each([
      [`https://www.youtube.com/watch?v=${ID}`, ID],
      [`https://youtube.com/watch?v=${ID}&t=42s`, ID],
      [`https://m.youtube.com/watch?v=${ID}`, ID],
      [`https://www.youtube.com/watch?v=${ID}&list=PL123`, ID],
      [`https://youtu.be/${ID}`, ID],
      [`https://youtu.be/${ID}?si=abc`, ID],
      [`https://www.youtube.com/live/${ID}`, ID],
      [`https://www.youtube.com/embed/${ID}`, ID],
      [`https://www.youtube-nocookie.com/embed/${ID}`, ID],
      [`  https://youtu.be/${ID}  `, ID],
      ["https://www.youtube.com/playlist?list=PL123", null],
      [`https://www.youtube.com/shorts/${ID}`, null],
      ["https://www.youtube.com/@glimbiblecollege", null],
      [`https://vimeo.com/${ID}`, null],
      [`https://youtube.com.evil.example/watch?v=${ID}`, null],
      ["https://www.youtube.com/watch?v=short", null],
      [`ftp://youtu.be/${ID}`, null],
      ["not a url", null],
    ])("parses %s", (url, expected) => {
      expect(host.parseUrl(url)).toEqual(expected === null ? null : { videoId: expected });
    });

    it("embeds privacy-enhanced, inline, with an optional start", () => {
      expect(host.embed(ID, {})).toEqual({
        embedUrl: `https://www.youtube-nocookie.com/embed/${ID}?rel=0&playsinline=1&enablejsapi=1`,
        thumbnailUrl: `https://i.ytimg.com/vi/${ID}/mqdefault.jpg`,
      });
      expect(host.embed(ID, { startSeconds: 123.9 }).embedUrl).toContain("&start=123");
    });
  });
}

contract("YouTubeLinkHost", () => new YouTubeLinkHost());
contract("FakeVideoHost", () => new FakeVideoHost());

/** oEmbed answers as recorded from YouTube (S-Y1), replayed through an injected fetch. */
function replay(status: number, body?: unknown) {
  const calls: string[] = [];
  const host = new YouTubeLinkHost((url) => {
    calls.push(url);
    return Promise.resolve(
      new Response(body === undefined ? "Not Found" : JSON.stringify(body), { status }),
    );
  });
  return { host, calls };
}

describe("YouTubeLinkHost.checkVideo (recorded oEmbed responses)", () => {
  it("reads title, channel and thumbnail from an available (public or unlisted) video", async () => {
    const { host, calls } = replay(200, {
      title: "Hermeneutics, week 3",
      author_name: "GLIM Online Bible College",
      author_url: "https://www.youtube.com/@glimbiblecollege",
      type: "video",
      thumbnail_url: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
    });
    expect(await host.checkVideo(ID)).toEqual({
      status: "AVAILABLE",
      title: "Hermeneutics, week 3",
      channelUrl: "https://www.youtube.com/@glimbiblecollege",
      thumbnailUrl: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
    });
    expect(calls[0]).toBe(
      `https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${ID}&format=json`,
    );
  });

  it.each([
    [401, "PRIVATE_OR_RESTRICTED"],
    [403, "PRIVATE_OR_RESTRICTED"],
    [404, "NOT_FOUND"],
    [400, "NOT_FOUND"],
  ])("maps %i to %s", async (status, expected) => {
    expect((await replay(status).host.checkVideo(ID)).status).toBe(expected);
  });

  it("can't tell on a 5xx, a 429 or a network failure", async () => {
    await expect(replay(503).host.checkVideo(ID)).rejects.toBeInstanceOf(VideoHostUnavailableError);
    await expect(replay(429).host.checkVideo(ID)).rejects.toBeInstanceOf(VideoHostUnavailableError);
    const offline = new YouTubeLinkHost(() => Promise.reject(new TypeError("fetch failed")));
    await expect(offline.checkVideo(ID)).rejects.toBeInstanceOf(VideoHostUnavailableError);
  });
});

describe("FakeVideoHost scripting", () => {
  it("answers as scripted, and can be down", async () => {
    const fake = new FakeVideoHost().script(ID, { status: "NOT_FOUND" });
    expect((await fake.checkVideo(ID)).status).toBe("NOT_FOUND");
    expect((await fake.checkVideo("aaaaaaaaaaa")).status).toBe("AVAILABLE");
    fake.down = true;
    await expect(fake.checkVideo(ID)).rejects.toBeInstanceOf(VideoHostUnavailableError);
  });
});

it("normalises channel URLs for the allow-list", () => {
  expect(normaliseChannelUrl("http://m.youtube.com/@GLIMBibleCollege/")).toBe(
    normaliseChannelUrl("https://www.youtube.com/@glimbiblecollege"),
  );
});
