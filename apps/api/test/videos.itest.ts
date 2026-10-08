import type { Video } from "@glim/contracts";
import { FAKE_CHANNEL_URL } from "@glim/integrations/video-host/fake";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { PolicyService } from "@glim/modules/identity";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type PersonaName, type Personas } from "./personas";

/**
 * Adding YouTube recordings to a course (TRD §13.1, §13.3, §13.6; D-05). O1 is taught by
 * l1Primary (PRIMARY), l2Co and l3Assistant, and taken by sEnrolled (sCompleted has finished it;
 * sGraduated has graduated; sOther takes O2). YouTube is the fake: every well-formed id is an
 * available video on FAKE_CHANNEL_URL unless scripted.
 */

let t: TestApp;
let p: Personas;
const id = (n: number) => `vid${String(n).padStart(8, "0")}`; // 11 characters

interface ErrorBody {
  error: { code: string; fieldErrors?: { path: string }[] };
}

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

function add(as: PersonaName, payload: Record<string, unknown>, offering = p.world.offerings.O1) {
  return t.request({
    method: "POST",
    url: `/api/v1/course-offerings/${offering}/videos`,
    headers: { ...p[as].headers, "idempotency-key": idempotencyKey() },
    payload,
  });
}

const list = (as: PersonaName, offering = p.world.offerings.O1) =>
  t.request({ url: `/api/v1/course-offerings/${offering}/videos`, headers: p[as].headers });

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  await q("UPDATE settings SET youtube_channel_urls = $1", [[FAKE_CHANNEL_URL]]);
});

afterAll(async () => {
  await t.close();
});

describe("adding a recording by link", () => {
  it("checks the link, prefills the title from YouTube and publishes it", async () => {
    const res = await add("l1Primary", { youtubeUrl: `https://youtu.be/${id(1)}` });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<Video>()).toMatchObject({
      title: `Fake video ${id(1)}`,
      status: "PUBLISHED",
      youtubeVideoId: id(1),
      position: 0,
      visibility: "ENROLLED",
    });
    expect(t.videoHost.checked).toContain(id(1));
    const audit = await q<{ n: string }>(
      "SELECT count(*) AS n FROM audit_logs WHERE action = 'video.asset.added'",
    );
    expect(Number(audit.rows[0]?.n)).toBe(1);
    const events = await q<{ name: string }>(
      "SELECT data->>'name' AS name FROM pgboss.job WHERE name = 'domain-event' AND data->>'name' LIKE 'video.%' ORDER BY created_on",
    );
    expect(events.rows.map((e) => e.name)).toEqual(["video.added", "video.published"]);
  });

  it("takes an edited title, a Class Meeting of the course and a release time", async () => {
    const meeting = await t.request({
      method: "POST",
      url: `/api/v1/course-offerings/${p.world.offerings.O1}/class-meetings`,
      headers: { ...p.l1Primary.headers, "idempotency-key": idempotencyKey() },
      payload: {
        title: "Week 1",
        scheduledStart: "2080-09-07T09:00:00Z",
        scheduledEnd: "2080-09-07T10:00:00Z",
      },
    });
    const meetingId = meeting.json<{ meeting: { id: string } }>().meeting.id;
    const res = await add("l2Co", {
      youtubeUrl: `https://www.youtube.com/watch?v=${id(2)}`,
      title: "Week 1: Introduction",
      classMeetingId: meetingId,
      publishAfter: "2026-11-09T09:00:00Z",
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<Video>()).toMatchObject({
      title: "Week 1: Introduction",
      classMeetingId: meetingId,
      publishAfter: "2026-11-09T09:00:00.000Z",
      position: 1,
    });
    const otherOffering = await add("l1Primary", {
      youtubeUrl: `https://youtu.be/${id(3)}`,
      classMeetingId: "00000000-0000-7000-8000-000000000000",
    });
    expect(otherOffering.statusCode).toBe(400);
  });

  it.each([
    ["not a YouTube video", "https://vimeo.com/123", null, 400, "YOUTUBE_URL_INVALID"],
    ["a playlist", "https://www.youtube.com/playlist?list=PL1", null, 400, "YOUTUBE_URL_INVALID"],
    ["private", null, { status: "PRIVATE_OR_RESTRICTED" }, 422, "YOUTUBE_VIDEO_PRIVATE"],
    ["deleted", null, { status: "NOT_FOUND" }, 422, "YOUTUBE_VIDEO_NOT_FOUND"],
    [
      "another channel",
      null,
      { status: "AVAILABLE", title: "Mine", channelUrl: "https://www.youtube.com/@someoneelse" },
      422,
      "YOUTUBE_CHANNEL_NOT_ALLOWED",
    ],
  ] as const)("refuses a link that is %s", async (_why, url, script, status, code) => {
    const videoId = id(100 + status + code.length);
    if (script !== null) t.videoHost.script(videoId, script);
    const res = await add("l1Primary", { youtubeUrl: url ?? `https://youtu.be/${videoId}` });
    expect(res.statusCode).toBe(status);
    expect(res.json<ErrorBody>().error.code).toBe(code);
  });

  it("says when YouTube can't be checked, and refuses the same video twice", async () => {
    t.videoHost.down = true;
    const down = await add("l1Primary", { youtubeUrl: `https://youtu.be/${id(4)}` });
    t.videoHost.down = false;
    expect(down.statusCode).toBe(503);
    expect(down.json<ErrorBody>().error.code).toBe("VIDEO_CHECK_UNAVAILABLE");
    const again = await add("l1Primary", { youtubeUrl: `https://www.youtube.com/live/${id(1)}` });
    expect(again.statusCode).toBe(409);
  });

  it("refuses every channel until one is set up in Settings", async () => {
    await q("UPDATE settings SET youtube_channel_urls = '{}'");
    const res = await add("l1Primary", { youtubeUrl: `https://youtu.be/${id(5)}` });
    await q("UPDATE settings SET youtube_channel_urls = $1", [[FAKE_CHANNEL_URL]]);
    expect(res.json<ErrorBody>().error.code).toBe("YOUTUBE_CHANNEL_NOT_ALLOWED");
  });

  it("adds unpublished when the RECORDING policy turns auto-publish off", async () => {
    const policies = t.app.get(PolicyService);
    const current = await policies.current("RECORDING");
    await policies.save(
      "RECORDING",
      current.version,
      { ...current.config, autoPublish: false },
      SYSTEM_ACTOR,
    );
    const res = await add("acadAdmin", { youtubeUrl: `https://youtu.be/${id(6)}` });
    const latest = await policies.current("RECORDING");
    await policies.save(
      "RECORDING",
      latest.version,
      { ...latest.config, autoPublish: true },
      SYSTEM_ACTOR,
    );
    expect(res.json<Video>()).toMatchObject({ status: "UNPUBLISHED", publishedAt: null });
  });

  it("is for the course's Primary and Co-lecturers and admins only (D-05)", async () => {
    for (const who of ["l3Assistant", "l4Other", "sEnrolled", "registrar"] as const) {
      const res = await add(who, { youtubeUrl: `https://youtu.be/${id(7)}` });
      expect([403, 404], who).toContain(res.statusCode);
    }
    expect((await add("sysAdmin", { youtubeUrl: `https://youtu.be/${id(7)}` })).statusCode).toBe(
      201,
    );
  });
});

describe("the course's recordings", () => {
  it("shows students the published ones whose release time has passed", async () => {
    const titles = async (as: PersonaName) =>
      (await list(as)).json<{ items: Video[] }>().items.map((v) => v.title);
    expect(await titles("sEnrolled")).toEqual([`Fake video ${id(1)}`, `Fake video ${id(7)}`]);
    expect(await titles("sCompleted")).toEqual([`Fake video ${id(1)}`, `Fake video ${id(7)}`]);
    // People who manage them see everything, including unpublished and not-yet-released.
    expect(await titles("l1Primary")).toHaveLength(4);
    expect(await titles("l3Assistant")).toHaveLength(2);
    t.clock.set("2026-11-09T09:00:01Z");
    for (const name of Object.keys(p).filter((k) => k !== "world") as PersonaName[])
      p[name].headers = await sessionFor(t, p[name].userId);
    expect(await titles("sEnrolled")).toContain("Week 1: Introduction");
  });

  it("hides them from people not entitled", async () => {
    for (const who of ["sOther", "sGraduated", "noRole", "applicant"] as const)
      expect([403, 404], who).toContain((await list(who)).statusCode);
  });

  it("publishes and unpublishes, idempotently", async () => {
    const items = (await list("l1Primary")).json<{ items: Video[] }>().items;
    const hidden = items.find((v) => v.status === "UNPUBLISHED");
    const shown = items.find((v) => v.youtubeVideoId === id(1));
    if (hidden === undefined || shown === undefined) throw new Error("fixtures missing");
    const act = (videoId: string, action: "publish" | "unpublish") =>
      t.request({
        method: "POST",
        url: `/api/v1/videos/${videoId}/${action}`,
        headers: { ...p.l1Primary.headers, "idempotency-key": idempotencyKey() },
      });
    expect((await act(hidden.id, "publish")).json<Video>().status).toBe("PUBLISHED");
    expect((await act(hidden.id, "publish")).json<Video>().status).toBe("PUBLISHED");
    expect((await act(shown.id, "unpublish")).json<Video>().status).toBe("UNPUBLISHED");
    const student = await t.request({
      url: `/api/v1/videos/${shown.id}`,
      headers: p.sEnrolled.headers,
    });
    expect(student.statusCode).toBe(404);
  });

  it("edits metadata with If-Match and reorders", async () => {
    const items = (await list("l1Primary")).json<{ items: Video[] }>().items;
    const first = items[0];
    if (first === undefined) throw new Error("no videos");
    const patched = await t.request({
      method: "PATCH",
      url: `/api/v1/videos/${first.id}`,
      headers: { ...p.l2Co.headers, "if-match": `"${String(first.version)}"` },
      payload: { title: "Renamed", description: "Notes" },
    });
    expect(patched.json<Video>()).toMatchObject({ title: "Renamed", description: "Notes" });
    const stale = await t.request({
      method: "PATCH",
      url: `/api/v1/videos/${first.id}`,
      headers: { ...p.l2Co.headers, "if-match": `"${String(first.version)}"` },
      payload: { title: "Stale" },
    });
    expect(stale.statusCode).toBe(412);

    const reversed = items.map((v) => v.id).reverse();
    const order = await t.request({
      method: "PUT",
      url: `/api/v1/course-offerings/${p.world.offerings.O1}/videos/order`,
      headers: p.l1Primary.headers,
      payload: { videoIds: reversed },
    });
    expect(order.statusCode, order.body).toBe(200);
    expect(order.json<{ items: Video[] }>().items.map((v) => v.id)).toEqual(reversed);
    const partial = await t.request({
      method: "PUT",
      url: `/api/v1/course-offerings/${p.world.offerings.O1}/videos/order`,
      headers: p.l1Primary.headers,
      payload: { videoIds: reversed.slice(1) },
    });
    expect(partial.statusCode).toBe(400);
  });
});
