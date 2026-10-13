import { describe, expect, it } from "vitest";
import { encodeMeetEnvelope, parseMeetEnvelope } from "../google/events";
import { liveProviderContract } from "./contract";
import { FakeLiveProvider } from "./fake";
import { MeetWorld } from "./world";

liveProviderContract("FakeLiveProvider", () => {
  const world = new MeetWorld();
  return Promise.resolve({ provider: new FakeLiveProvider(world), world });
});

describe("Meet event envelopes", () => {
  const at = new Date("2026-11-02T10:00:00Z");
  it.each([
    ["CONFERENCE_STARTED", { conferenceId: "c1" }, { conferenceId: "c1", recordingId: null }],
    ["CONFERENCE_ENDED", { conferenceId: "c1" }, { conferenceId: "c1", recordingId: null }],
    [
      "PARTICIPANT_JOINED",
      { conferenceId: "c1", participant: { participantId: "p1", sessionId: "s1" } },
      { conferenceId: "c1", recordingId: null },
    ],
    [
      "RECORDING_READY",
      { conferenceId: "c1", recordingId: "r1" },
      { conferenceId: "c1", recordingId: "r1" },
    ],
    [
      "SUBSCRIPTION_LIFECYCLE",
      { subscription: "sub1" },
      { conferenceId: null, subscription: "sub1" },
    ],
  ] as const)("round-trips %s", (type, extra, expected) => {
    const event = parseMeetEnvelope(
      encodeMeetEnvelope({ messageId: "m1", type, at, hostUserId: "42", ...extra }),
    );
    expect(event).toMatchObject({
      eventId: "m1",
      type,
      occurredAt: at,
      spaceId: null,
      ...expected,
    });
  });

  it("ignores unknown types and malformed data", () => {
    const good = encodeMeetEnvelope({
      messageId: "m2",
      type: "CONFERENCE_STARTED",
      at,
      hostUserId: "42",
      conferenceId: "c1",
    });
    expect(
      parseMeetEnvelope({ ...good, attributes: { ...good.attributes, "ce-type": "x" } }),
    ).toBeNull();
    expect(
      parseMeetEnvelope({ ...good, data: Buffer.from("{not json").toString("base64") }),
    ).toBeNull();
  });
});
