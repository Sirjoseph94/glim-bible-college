import type { PlaybackProgress, Video, VideoPlayback } from "@glim/contracts";
import { FAKE_CHANNEL_URL } from "@glim/integrations/video-host/fake";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type PersonaName, type Personas } from "./personas";

/**
 * Watching recordings with resume (TRD §13.4–13.5; AC-08, AC-09). O1 is taught by l1Primary and
 * taken by sEnrolled; sCompleted finished it (still entitled while their programme enrollment is
 * ACTIVE); sGraduated has graduated; sOther takes O2.
 */

let t: TestApp;
let p: Personas;
let video: Video;
let hidden: Video;

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

const play = (as: PersonaName, id = video.id) =>
  t.request({ url: `/api/v1/videos/${id}/play`, headers: p[as].headers });

const report = (as: PersonaName, positionMs: number, seq: number, durationMs = 3_600_000) =>
  t.request({
    method: "PATCH",
    url: `/api/v1/videos/${video.id}/progress`,
    headers: p[as].headers,
    payload: { positionMs, durationMs, seq },
  });

async function add(youtubeVideoId: string): Promise<Video> {
  const res = await t.request({
    method: "POST",
    url: `/api/v1/course-offerings/${p.world.offerings.O1}/videos`,
    headers: { ...p.l1Primary.headers, "idempotency-key": idempotencyKey() },
    payload: { youtubeUrl: `https://youtu.be/${youtubeVideoId}` },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Video>();
}

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  await q("UPDATE settings SET youtube_channel_urls = $1", [[FAKE_CHANNEL_URL]]);
  video = await add("play0000001");
  hidden = await add("play0000002");
  await t.request({
    method: "POST",
    url: `/api/v1/videos/${hidden.id}/unpublish`,
    headers: p.l1Primary.headers,
  });
});

afterAll(async () => {
  await t.close();
});

describe("GET /videos/:id/play", () => {
  it("gives an enrolled student the privacy-enhanced embed, uncached", async () => {
    const res = await play("sEnrolled");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json<VideoPlayback>();
    expect(body).toMatchObject({
      videoId: video.id,
      courseOfferingId: p.world.offerings.O1,
      courseCode: "PBIB101",
      youtubeVideoId: "play0000001",
      thumbnailUrl: "https://i.ytimg.com/vi/play0000001/mqdefault.jpg",
      durationMs: null,
      resumeMs: 0,
      tracksProgress: true,
    });
    const embed = new URL(body.embedUrl);
    expect(embed.origin).toBe("https://www.youtube-nocookie.com");
    expect(embed.pathname).toBe("/embed/play0000001");
    expect(Object.fromEntries(embed.searchParams)).toEqual({
      rel: "0",
      playsinline: "1",
      enablejsapi: "1",
    });
  });

  it("is for students whose course enrollment is ENROLLED or COMPLETED while studying (AC-08)", async () => {
    expect((await play("sCompleted")).statusCode).toBe(200);
    for (const who of ["sGraduated", "sOther", "applicant", "noRole", "l4Other"] as const)
      expect((await play(who)).statusCode, who).toBe(404);
  });

  it("hides unpublished videos from students but lets the course's Lecturers preview them", async () => {
    expect((await play("sEnrolled", hidden.id)).statusCode).toBe(404);
    const preview = await play("l1Primary", hidden.id);
    expect(preview.json<VideoPlayback>().courseOfferingId).toBe(p.world.offerings.O1);
    expect(preview.statusCode).toBe(200);
    expect(preview.json<VideoPlayback>().tracksProgress).toBe(false);
    expect((await play("acadAdmin", hidden.id)).statusCode).toBe(200);
  });

  it("hides a video until its release time", async () => {
    const later = await add("play0000003");
    await q("UPDATE videos SET publish_after = $1 WHERE id = $2", [
      new Date(t.clock.now().getTime() + 60_000),
      later.id,
    ]);
    expect((await play("sEnrolled", later.id)).statusCode).toBe(404);
    t.clock.advance({ minutes: 2 });
    expect((await play("sEnrolled", later.id)).statusCode).toBe(200);
  });
});

describe("PATCH /videos/:id/progress (AC-09)", () => {
  it("learns the duration from the first report and resumes there", async () => {
    const first = await report("sEnrolled", 120_000, 1);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<PlaybackProgress>()).toEqual({
      positionMs: 120_000,
      maxPositionMs: 120_000,
      durationMs: 3_600_000,
      completed: false,
    });
    const again = (await play("sEnrolled")).json<VideoPlayback>();
    expect(again).toMatchObject({ durationMs: 3_600_000, resumeMs: 120_000 });
    expect(new URL(again.embedUrl).searchParams.get("start")).toBe("120");
  });

  it("keeps the first duration it learned", async () => {
    t.clock.advance({ seconds: 15 });
    const res = await report("sEnrolled", 150_000, 2, 10_000_000);
    expect(res.json<PlaybackProgress>().durationMs).toBe(3_600_000);
  });

  it("ignores a report within 5 s of the last one, and a stale seq", async () => {
    t.clock.advance({ seconds: 2 });
    expect((await report("sEnrolled", 160_000, 3)).json<PlaybackProgress>().positionMs).toBe(
      150_000,
    );
    t.clock.advance({ seconds: 15 });
    expect((await report("sEnrolled", 900_000, 2)).json<PlaybackProgress>().positionMs).toBe(
      150_000,
    );
  });

  it("keeps the furthest point when the viewer seeks back, and clamps to the duration", async () => {
    t.clock.advance({ seconds: 15 });
    expect((await report("sEnrolled", 60_000, 4)).json<PlaybackProgress>()).toMatchObject({
      positionMs: 60_000,
      maxPositionMs: 150_000,
    });
    t.clock.advance({ seconds: 15 });
    expect((await report("sEnrolled", 9_999_999, 5)).json<PlaybackProgress>()).toMatchObject({
      positionMs: 3_600_000,
      maxPositionMs: 3_600_000,
      completed: true,
    });
  });

  it("completes at 90 % and starts a finished video from the beginning", async () => {
    t.clock.advance({ seconds: 15 });
    const res = await report("sCompleted", 3_240_000, 1);
    expect(res.json<PlaybackProgress>().completed).toBe(true);
    const row = await q<{ percent_complete: string; completed_at: Date | null }>(
      "SELECT percent_complete, completed_at FROM playback_progress WHERE user_id = $1",
      [p.sCompleted.userId],
    );
    expect(row.rows[0]?.percent_complete).toBe("90.00");
    expect(row.rows[0]?.completed_at).not.toBeNull();
    t.clock.advance({ seconds: 15 });
    expect((await report("sCompleted", 30_000, 2)).json<PlaybackProgress>().completed).toBe(true);
    expect((await play("sCompleted")).json<VideoPlayback>().resumeMs).toBe(0);
  });

  it("is only for entitled students; staff keep no progress", async () => {
    for (const who of ["l1Primary", "acadAdmin", "sGraduated", "sOther"] as const)
      expect((await report(who, 1000, 1)).statusCode, who).toBe(404);
    const bad = await report("sEnrolled", -1, 9);
    expect(bad.statusCode).toBe(400);
  });

  it("ends when the course enrollment is dropped (AC-08)", async () => {
    await q(
      "UPDATE course_enrollments SET status = 'DROPPED' WHERE student_id = (SELECT id FROM students WHERE user_id = $1)",
      [p.sEnrolled.userId],
    );
    expect((await play("sEnrolled")).statusCode).toBe(404);
    t.clock.advance({ seconds: 15 });
    expect((await report("sEnrolled", 200_000, 10)).statusCode).toBe(404);
  });

  it("rate-limits progress reports per user", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 13; i++) codes.push((await report("registrar", 1000, i)).statusCode);
    expect(codes.at(-1)).toBe(429);
  });
});
