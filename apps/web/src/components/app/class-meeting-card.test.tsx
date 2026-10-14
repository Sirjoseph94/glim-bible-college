import type { ClassMeeting } from "@glim/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClassMeetingCard } from "./class-meeting-card";

const base = {
  id: "m1",
  courseCode: "PAS101",
  courseTitle: "Pastoral Care",
  title: "Week 3: Visiting the sick",
  scheduledStart: "2026-10-13T09:00:00Z",
  scheduledEnd: "2026-10-13T10:00:00Z",
  room: null,
  hasOnlineLink: true,
  onlineLink: null,
  providerStatus: null,
  joinUrl: null,
  provisionError: null,
} as unknown as ClassMeeting;

function render(state: ClassMeeting["state"], extra: Partial<ClassMeeting> = {}) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ClassMeetingCard meeting={{ ...base, ...extra, state }} />
    </QueryClientProvider>,
  );
}
const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>(?:<svg.*?<\/svg>)?([^<]*)<\/button>/g)].map((m) => m[1]);

describe("ClassMeetingCard for a student (handoff §9.14)", () => {
  it("offers Join class while the class is open to join", () => {
    const html = render("OPEN");
    expect(html).toContain("Open to join");
    expect(buttons(html)).toEqual(["Join class"]);
    expect(html).toContain("bg-brand");
  });

  it("marks a live class in the live colour, with Join live class", () => {
    const html = render("LIVE");
    expect(html).toContain("Live now");
    expect(buttons(html)).toEqual(["Join live class"]);
    expect(html).toContain("bg-live-soft");
    expect(html).toContain("border-live");
  });

  it("has nothing to press before the class opens or after it ends", () => {
    for (const state of ["SCHEDULED", "ENDED", "NO_SHOW"] as const)
      expect(buttons(render(state))).toEqual([]);
    expect(render("NO_SHOW")).toContain("Didn&#x27;t take place");
  });

  it("says how soon a scheduled class starts, within the day (§10.6)", () => {
    const soon = new Date(Date.now() + (3 * 60 + 20) * 60_000 + 30_000).toISOString();
    const html = render("SCHEDULED", { scheduledStart: soon });
    expect(html).toContain("Starts in 3 h 20 min");
    expect(render("SCHEDULED", { scheduledStart: "2099-01-01T09:00:00Z" })).not.toContain(
      "Starts in",
    );
  });

  it("expects a recording after a class that was recorded", () => {
    expect(render("ENDED", { recordingMode: "AUTO" })).toContain("Recording expected");
    expect(render("ENDED", { recordingMode: "OFF" })).not.toContain("Recording expected");
  });

  it("strikes through a cancelled class and offers nothing", () => {
    const html = render("CANCELLED");
    expect(html).toContain("line-through");
    expect(buttons(html)).toEqual([]);
  });

  it("says where it is when there is a room, and offers no join without an online link", () => {
    const html = render("OPEN", {
      hasOnlineLink: false,
      room: { id: "r1", code: "CHAPEL", name: "Chapel" },
    });
    expect(html).toContain("On campus: Chapel");
    expect(buttons(html)).toEqual([]);
  });

  it("lets students try a Google Meet class whose link is still being made, or join by phone", () => {
    const html = render("OPEN", { hasOnlineLink: false, providerStatus: "PENDING" });
    expect(html).toContain("Online");
    expect(buttons(html)).toEqual(["Join class", "Join by phone instead"]);
  });

  it("never shows the Meet link itself", () => {
    expect(render("LIVE", { onlineLink: "https://meet.google.com/abc-defg-hij" })).not.toContain(
      "meet.google.com",
    );
  });
});
