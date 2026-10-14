import { describe, expect, it } from "vitest";
import { pickMeetingRecording, type MeetingVideo } from "./meeting-recording";

const video = (over: Partial<MeetingVideo> & { id: string }): MeetingVideo => ({
  status: "PUBLISHED",
  forStudents: true,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  ...over,
});
const older = new Date("2026-10-01T09:00:00Z");
const newer = new Date("2026-10-01T11:00:00Z");

describe("pickMeetingRecording, for a student", () => {
  it("is null without videos", () => {
    expect(pickMeetingRecording([], false)).toBeNull();
  });

  it("is PUBLISHED only when the student may play it", () => {
    expect(pickMeetingRecording([video({ id: "a" })], false)).toEqual({
      videoId: "a",
      status: "PUBLISHED",
    });
  });

  it("shows nothing for a published video the student can't watch (staff-only or not released)", () => {
    expect(pickMeetingRecording([video({ id: "a", forStudents: false })], false)).toBeNull();
  });

  it("shows PROCESSING while a video they'll be able to watch processes", () => {
    expect(pickMeetingRecording([video({ id: "a", status: "PROCESSING" })], false)).toEqual({
      videoId: "a",
      status: "PROCESSING",
    });
  });

  it("shows nothing for a processing video that won't be for them", () => {
    expect(
      pickMeetingRecording([video({ id: "a", status: "PROCESSING", forStudents: false })], false),
    ).toBeNull();
  });

  it.each(["UNPUBLISHED", "UNAVAILABLE", "FAILED", "DELETED"] as const)(
    "shows nothing for a %s video",
    (status) => {
      expect(pickMeetingRecording([video({ id: "a", status })], false)).toBeNull();
    },
  );

  it("prefers a playable video over a processing one, whatever their age", () => {
    const videos = [
      video({ id: "upload", status: "PROCESSING", createdAt: newer }),
      video({ id: "link", createdAt: older }),
    ];
    expect(pickMeetingRecording(videos, false)).toEqual({ videoId: "link", status: "PUBLISHED" });
  });

  it("takes the newest of equals", () => {
    const videos = [video({ id: "old", createdAt: older }), video({ id: "new", createdAt: newer })];
    expect(pickMeetingRecording(videos, false)?.videoId).toBe("new");
  });
});

describe("pickMeetingRecording, for staff who manage the offering's videos", () => {
  it("is PUBLISHED for any published video, meant for students or not", () => {
    expect(pickMeetingRecording([video({ id: "a", forStudents: false })], true)).toEqual({
      videoId: "a",
      status: "PUBLISHED",
    });
  });

  it("shows PROCESSING for a staff-only video too", () => {
    expect(
      pickMeetingRecording([video({ id: "a", status: "PROCESSING", forStudents: false })], true),
    ).toEqual({ videoId: "a", status: "PROCESSING" });
  });

  it("maps UNPUBLISHED to NOT_PUBLISHED, and FAILED and UNAVAILABLE to FAILED", () => {
    expect(pickMeetingRecording([video({ id: "a", status: "UNPUBLISHED" })], true)?.status).toBe(
      "NOT_PUBLISHED",
    );
    expect(pickMeetingRecording([video({ id: "a", status: "FAILED" })], true)?.status).toBe(
      "FAILED",
    );
    expect(pickMeetingRecording([video({ id: "a", status: "UNAVAILABLE" })], true)?.status).toBe(
      "FAILED",
    );
  });

  it("is null for a deleted video", () => {
    expect(pickMeetingRecording([video({ id: "a", status: "DELETED" })], true)).toBeNull();
  });

  it("ranks PUBLISHED, then NOT_PUBLISHED, then PROCESSING, then FAILED", () => {
    const failed = video({ id: "failed", status: "FAILED", createdAt: newer });
    const processing = video({ id: "processing", status: "PROCESSING", createdAt: newer });
    const unpublished = video({ id: "unpublished", status: "UNPUBLISHED", createdAt: newer });
    const published = video({ id: "published", createdAt: older });
    expect(pickMeetingRecording([failed, processing], true)?.videoId).toBe("processing");
    expect(pickMeetingRecording([failed, processing, unpublished], true)?.videoId).toBe(
      "unpublished",
    );
    expect(pickMeetingRecording([failed, processing, unpublished, published], true)?.videoId).toBe(
      "published",
    );
  });
});
