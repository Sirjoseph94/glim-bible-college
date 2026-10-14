import type { ClassMeeting } from "@glim/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
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
  recording: null,
} as unknown as ClassMeeting;

/** Links need a router to build their href; this one has no pages. */
const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
const markup = (node: ReactNode) =>
  renderToStaticMarkup(
    <RouterContextProvider router={router}>
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </RouterContextProvider>,
  );

function render(state: ClassMeeting["state"], extra: Partial<ClassMeeting> = {}) {
  return markup(<ClassMeetingCard meeting={{ ...base, ...extra, state }} />);
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

  it("says a recording is processing instead of expected", () => {
    const html = render("ENDED", {
      recordingMode: "AUTO",
      recording: { videoId: "v1", status: "PROCESSING" },
    });
    expect(html).toContain("Recording processing");
    expect(html).not.toContain("Recording expected");
    expect(html).not.toContain("Watch recording");
  });

  it("links a ready recording to its player", () => {
    const html = render("ENDED", {
      recordingMode: "AUTO",
      recording: { videoId: "v1", status: "PUBLISHED" },
    });
    expect(html).toContain("Recording ready");
    expect(html).toMatch(
      /<a[^>]*href="\/recordings\/v1"[^>]*>(?:<svg.*?<\/svg>)?Watch recording<\/a>/,
    );
    expect(html).not.toContain("Recording expected");
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

describe("ClassMeetingCard for staff who manage the offering's videos", () => {
  const lecturer = (recording: ClassMeeting["recording"]) =>
    markup(
      <ClassMeetingCard
        meeting={{ ...base, state: "ENDED", recordingMode: "AUTO", recording }}
        actions={<span>Roll call</span>}
      />,
    );

  it("says an unpublished recording is ready to publish", () => {
    const html = lecturer({ videoId: "v1", status: "NOT_PUBLISHED" });
    expect(html).toContain("Ready to publish");
    expect(html).not.toContain("Watch recording");
  });

  it("says a recording failed", () => {
    const html = lecturer({ videoId: "v1", status: "FAILED" });
    expect(html).toContain("Recording failed");
    expect(html).not.toContain("Watch recording");
  });

  it("links a published recording next to their own actions", () => {
    const html = lecturer({ videoId: "v1", status: "PUBLISHED" });
    expect(html).toContain("Watch recording");
    expect(html).toContain("Roll call");
  });
});
