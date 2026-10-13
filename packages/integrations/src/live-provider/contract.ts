import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ProviderNotFoundError,
  ProviderPermanentError,
  ProviderUnavailableError,
  type LiveProvider,
  type ProviderParticipantSession,
  type SpaceSettings,
} from "./port";
import type { MeetWorld } from "./world";

export interface ContractSubject {
  provider: LiveProvider;
  /** The Meet the provider talks to, for scripting what happens in a class. */
  world: MeetWorld;
  close?: () => Promise<void>;
}

const HOST = "lms-host-01@glim.test";
const SETTINGS: SpaceSettings = {
  accessType: "RESTRICTED",
  moderation: true,
  presentRestriction: "HOSTS_ONLY",
  autoRecording: true,
};

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}

async function readAll(body: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * The behaviour every `LiveProvider` shares (TRD §11.1, §21.3). Runs against the in-memory fake
 * and against `GoogleMeetProvider` talking HTTP to `FakeGoogleServer`, so neither can drift.
 */
export function liveProviderContract(name: string, setup: () => Promise<ContractSubject>): void {
  describe(`${name}: LiveProvider contract`, () => {
    let s: ContractSubject;
    beforeAll(async () => {
      s = await setup();
    });
    afterAll(async () => {
      await s.close?.();
    });

    it("provisions a space with a Meet link and code", async () => {
      const space = await s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS });
      expect(space.joinUrl).toBe(`https://meet.google.com/${space.meetingCode}`);
      expect(space.meetingCode).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
      expect(s.world.space(space.spaceId)?.settings).toEqual(SETTINGS);
    });

    it("syncs members to exactly the given list, idempotently", async () => {
      const { spaceId } = await s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS });
      const space = { hostEmail: HOST, spaceId };
      const first = await s.provider.syncAccess({
        space,
        cohosts: ["lecturer@glim.test"],
        members: ["a@gmail.com", "B@gmail.com"],
      });
      expect(first).toEqual({ added: 3, removed: 0, failed: [] });
      const again = await s.provider.syncAccess({
        space,
        cohosts: ["lecturer@glim.test"],
        members: ["a@gmail.com", "b@gmail.com"],
      });
      expect(again).toEqual({ added: 0, removed: 0, failed: [] });
      const dropped = await s.provider.syncAccess({
        space,
        cohosts: ["lecturer@glim.test"],
        members: ["a@gmail.com"],
      });
      expect(dropped).toEqual({ added: 0, removed: 1, failed: [] });
      expect(Object.fromEntries(s.world.space(spaceId)?.members ?? [])).toEqual({
        "lecturer@glim.test": "COHOST",
        "a@gmail.com": "MEMBER",
      });
    });

    it("reports conferences, the active one, participants and recordings", async () => {
      const { spaceId } = await s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS });
      const space = { hostEmail: HOST, spaceId };
      expect(await s.provider.getSpaceStatus(space)).toEqual({ activeConferenceId: null });

      const t0 = new Date("2026-11-02T09:00:00Z");
      const conferenceId = s.world.startConference(spaceId, t0);
      expect(await s.provider.getSpaceStatus(space)).toEqual({ activeConferenceId: conferenceId });
      s.world.addSession(conferenceId, {
        providerUserId: "users/111",
        displayName: "Ada Obi",
        startedAt: new Date("2026-11-02T09:01:00Z"),
        endedAt: new Date("2026-11-02T09:40:00Z"),
      });
      s.world.addSession(conferenceId, {
        kind: "PHONE",
        displayName: "+234 *** 12",
        startedAt: new Date("2026-11-02T09:05:00Z"),
      });
      s.world.addSession(conferenceId, {
        kind: "ANONYMOUS",
        displayName: "Guest",
        startedAt: new Date("2026-11-02T09:06:00Z"),
      });

      await s.provider.endActiveConference(space);
      expect(await s.provider.getSpaceStatus(space)).toEqual({ activeConferenceId: null });
      const conferences = await s.provider.listConferences(space);
      expect(conferences).toHaveLength(1);
      expect(conferences[0]?.conferenceId).toBe(conferenceId);
      expect(conferences[0]?.startedAt.toISOString()).toBe(t0.toISOString());
      expect(conferences[0]?.endedAt).not.toBeNull();
      expect((await s.provider.getConference({ hostEmail: HOST, conferenceId })).spaceId).toBe(
        spaceId,
      );

      const sessions: ProviderParticipantSession[] = await collect(
        s.provider.listParticipantSessions({ hostEmail: HOST, conferenceId }),
      );
      expect(sessions.map((x) => [x.kind, x.providerUserId, x.displayName])).toEqual([
        ["SIGNED_IN", "users/111", "Ada Obi"],
        ["PHONE", null, "+234 *** 12"],
        ["ANONYMOUS", null, "Guest"],
      ]);
      expect(sessions[0]?.endedAt?.toISOString()).toBe("2026-11-02T09:40:00.000Z");
      expect(new Set(sessions.map((x) => x.sessionId)).size).toBe(3);

      const recording = s.world.addRecording(conferenceId, {
        bytes: Buffer.from("0123456789"),
        durationMs: 2_340_000,
      });
      const recordings = await s.provider.listRecordings({ hostEmail: HOST, conferenceId });
      expect(recordings).toEqual([
        expect.objectContaining({
          recordingId: recording.recordingId,
          state: "FILE_GENERATED",
          fileId: recording.fileId,
        }),
      ]);
    });

    it("describes, streams (with a range) and trashes a recording file", async () => {
      const { spaceId } = await s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS });
      const conferenceId = s.world.startConference(spaceId);
      s.world.endConference(conferenceId);
      const { fileId } = s.world.addRecording(conferenceId, {
        bytes: Buffer.from("hello recording"),
        durationMs: 60_000,
      });
      const ref = { hostEmail: HOST, fileId: fileId ?? "" };
      expect(await s.provider.describeArtifact(ref)).toMatchObject({
        exists: true,
        sizeBytes: 15,
        mime: "video/mp4",
        durationMs: 60_000,
      });
      const whole = await s.provider.openArtifactStream(ref);
      expect(whole.sizeBytes).toBe(15);
      expect((await readAll(whole.body)).toString()).toBe("hello recording");
      const tail = await s.provider.openArtifactStream(ref, { rangeStart: 6 });
      expect((await readAll(tail.body)).toString()).toBe("recording");

      await s.provider.trashArtifact(ref);
      expect((await s.provider.describeArtifact(ref)).exists).toBe(false);
      await expect(s.provider.openArtifactStream(ref)).rejects.toBeInstanceOf(
        ProviderNotFoundError,
      );
      expect(
        (await s.provider.describeArtifact({ hostEmail: HOST, fileId: "missing" })).exists,
      ).toBe(false);
    });

    it("pulls events, parses them and forgets them once acknowledged", async () => {
      s.world.dropPending();
      const { spaceId } = await s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS });
      const conferenceId = s.world.startConference(spaceId, new Date("2026-11-03T08:00:00Z"));
      s.world.endConference(conferenceId, new Date("2026-11-03T09:00:00Z"));
      const pulled = await s.provider.pullEvents(10);
      const events = pulled.map((p) => s.provider.parseEvent(p.envelope));
      expect(events.map((e) => [e?.type, e?.conferenceId])).toEqual([
        ["CONFERENCE_STARTED", conferenceId],
        ["CONFERENCE_ENDED", conferenceId],
      ]);
      expect(events[1]?.occurredAt.toISOString()).toBe("2026-11-03T09:00:00.000Z");
      // Not acknowledged: delivered again.
      expect(await s.provider.pullEvents(10)).toHaveLength(2);
      await s.provider.ackEvents(pulled.map((p) => p.ackId));
      expect(await s.provider.pullEvents(10)).toHaveLength(0);
      expect(
        s.provider.parseEvent({
          messageId: "x",
          attributes: { "ce-type": "something.else" },
          data: "",
          publishTime: new Date().toISOString(),
        }),
      ).toBeNull();
    });

    it("subscribes a host account and renews the subscription", async () => {
      const sub = await s.provider.subscribe(HOST);
      expect(sub.expiresAt.getTime()).toBeGreaterThan(Date.now());
      const renewed = await s.provider.renewSubscription(HOST, sub.remoteName);
      expect(renewed.remoteName).toBe(sub.remoteName);
      expect(renewed.expiresAt.getTime()).toBeGreaterThanOrEqual(sub.expiresAt.getTime());
    });

    it("reports storage use and health", async () => {
      const usage = await s.provider.storageUsage(HOST);
      expect(usage.usedBytes).toBeGreaterThan(0);
      expect(await s.provider.health(HOST)).toEqual({ ok: true, detail: null });
    });

    it("maps failures to transient, permanent and not-found errors", async () => {
      s.world.failNext("provisionSpace", "unavailable", 6);
      await expect(
        s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS }),
      ).rejects.toBeInstanceOf(ProviderUnavailableError);
      // Drain what the adapter's retries didn't use, so the next script is next in line.
      while (s.world.take("provisionSpace") !== null);
      s.world.failNext("provisionSpace", "permanent");
      await expect(
        s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS }),
      ).rejects.toBeInstanceOf(ProviderPermanentError);
      await expect(
        s.provider.getSpaceStatus({ hostEmail: HOST, spaceId: "nope" }),
      ).rejects.toBeInstanceOf(ProviderNotFoundError);
    });
  });
}
