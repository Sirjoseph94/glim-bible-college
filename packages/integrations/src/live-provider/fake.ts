import { Readable } from "node:stream";
import { parseMeetEnvelope } from "../google/events";
import {
  ProviderNotFoundError,
  ProviderPermanentError,
  ProviderUnavailableError,
  type ArtifactMetadata,
  type ArtifactStream,
  type LiveProvider,
  type ProviderArtifactRef,
  type ProviderConference,
  type ProviderConferenceRef,
  type ProviderEvent,
  type ProviderHealth,
  type ProviderParticipantSession,
  type ProviderRecording,
  type ProviderSpaceRef,
  type ProviderSpaceStatus,
  type ProviderSubscription,
  type ProvisionedSpace,
  type ProvisionInput,
  type PulledEvent,
  type RawProviderEnvelope,
  type SyncAccessInput,
  type SyncAccessResult,
} from "./port";
import { MeetWorld, type WorldFailure } from "./world";

function fail(op: string, failure: WorldFailure): never {
  if (failure === "permanent") throw new ProviderPermanentError(`Fake ${op}: forbidden.`);
  if (failure === "notfound") throw new ProviderNotFoundError(`Fake ${op}: not found.`);
  throw new ProviderUnavailableError(`Fake ${op}: unavailable.`);
}

/**
 * A scriptable in-memory `LiveProvider` (TRD §11.1, §21.3) for development, e2e and tests. Its
 * `world` is the Meet it talks to: tests start conferences, add participants and recordings
 * there, and script failures with `world.failNext(op, …)` (op = the method name).
 */
export class FakeLiveProvider implements LiveProvider {
  readonly name = "fake" as const;

  constructor(readonly world: MeetWorld = new MeetWorld()) {}

  /** Runs `op` as the provider would: scripted failures and thrown errors become rejections. */
  private run<T>(op: string, fn: () => T): Promise<T> {
    try {
      const failure = this.world.take(op);
      if (failure !== null) fail(op, failure);
      return Promise.resolve(fn());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private spaceOf(ref: ProviderSpaceRef) {
    const space = this.world.space(ref.spaceId);
    if (space?.hostEmail !== ref.hostEmail) throw new ProviderNotFoundError("No such space.");
    return space;
  }

  private conferenceOf(ref: ProviderConferenceRef) {
    const conference = this.world.conferences.get(ref.conferenceId);
    if (conference === undefined) throw new ProviderNotFoundError("No such conference.");
    return conference;
  }

  provisionSpace(input: ProvisionInput): Promise<ProvisionedSpace> {
    return this.run("provisionSpace", () => {
      const space = this.world.createSpace(input.hostEmail, input.settings);
      return {
        spaceId: space.spaceId,
        joinUrl: space.joinUrl,
        meetingCode: space.meetingCode,
        dialIn: this.world.dialIn,
      };
    });
  }

  syncAccess(input: SyncAccessInput): Promise<SyncAccessResult> {
    return this.run("syncAccess", () => {
      const space = this.spaceOf(input.space);
      const want = new Map<string, "COHOST" | "MEMBER">();
      for (const email of input.members) want.set(email.toLowerCase(), "MEMBER");
      for (const email of input.cohosts) want.set(email.toLowerCase(), "COHOST");
      let added = 0;
      let removed = 0;
      for (const [email, role] of want)
        if (space.members.get(email) !== role) {
          space.members.set(email, role);
          added++;
        }
      for (const email of [...space.members.keys()])
        if (!want.has(email)) {
          space.members.delete(email);
          removed++;
        }
      return { added, removed, failed: [] };
    });
  }

  getSpaceStatus(ref: ProviderSpaceRef): Promise<ProviderSpaceStatus> {
    return this.run("getSpaceStatus", () => ({
      activeConferenceId: this.spaceOf(ref).activeConferenceId,
    }));
  }

  endActiveConference(ref: ProviderSpaceRef): Promise<void> {
    return this.run("endActiveConference", () => {
      const space = this.spaceOf(ref);
      if (space.activeConferenceId !== null) this.world.endConference(space.activeConferenceId);
    });
  }

  listConferences(ref: ProviderSpaceRef): Promise<ProviderConference[]> {
    return this.run("listConferences", () => {
      this.spaceOf(ref);
      return this.world
        .conferencesOf(ref.spaceId)
        .map(({ conferenceId, startedAt, endedAt }) => ({ conferenceId, startedAt, endedAt }));
    });
  }

  getConference(ref: ProviderConferenceRef): Promise<ProviderConference & { spaceId: string }> {
    return this.run("getConference", () => {
      const { conferenceId, startedAt, endedAt, spaceId } = this.conferenceOf(ref);
      return { conferenceId, startedAt, endedAt, spaceId };
    });
  }

  async *listParticipantSessions(
    conf: ProviderConferenceRef,
  ): AsyncIterable<ProviderParticipantSession> {
    const sessions = await this.run("listParticipantSessions", () => {
      this.conferenceOf(conf);
      return this.world.sessions.get(conf.conferenceId) ?? [];
    });
    for (const s of sessions)
      yield { ...s, raw: { participant: s.participantId, session: s.sessionId, kind: s.kind } };
  }

  listRecordings(conf: ProviderConferenceRef): Promise<ProviderRecording[]> {
    return this.run("listRecordings", () => {
      this.conferenceOf(conf);
      return (this.world.recordings.get(conf.conferenceId) ?? []).map(
        ({ recordingId, state, startedAt, endedAt, fileId }) => ({
          recordingId,
          state,
          startedAt,
          endedAt,
          fileId,
        }),
      );
    });
  }

  describeArtifact(ref: ProviderArtifactRef): Promise<ArtifactMetadata> {
    return this.run("describeArtifact", () => {
      const file = this.world.files.get(ref.fileId);
      if (file === undefined || file.trashed)
        return { exists: false, sizeBytes: null, md5: null, mime: null, durationMs: null };
      return {
        exists: true,
        sizeBytes: file.bytes.length,
        md5: null,
        mime: file.mime,
        durationMs: file.durationMs,
      };
    });
  }

  openArtifactStream(
    ref: ProviderArtifactRef,
    opts: { rangeStart?: number } = {},
  ): Promise<ArtifactStream> {
    return this.run("openArtifactStream", () => {
      const file = this.world.files.get(ref.fileId);
      if (file === undefined || file.trashed) throw new ProviderNotFoundError("No such file.");
      const bytes = file.bytes.subarray(opts.rangeStart ?? 0);
      return { body: Readable.from([bytes]), sizeBytes: bytes.length };
    });
  }

  trashArtifact(ref: ProviderArtifactRef): Promise<void> {
    return this.run("trashArtifact", () => {
      const file = this.world.files.get(ref.fileId);
      if (file === undefined) throw new ProviderNotFoundError("No such file.");
      file.trashed = true;
    });
  }

  parseEvent(envelope: RawProviderEnvelope): ProviderEvent | null {
    return parseMeetEnvelope(envelope);
  }

  pullEvents(max: number): Promise<PulledEvent[]> {
    return this.run("pullEvents", () =>
      [...this.world.pending.entries()]
        .slice(0, max)
        .map(([ackId, envelope]) => ({ ackId, envelope })),
    );
  }

  ackEvents(ackIds: string[]): Promise<void> {
    return this.run("ackEvents", () => {
      for (const id of ackIds) this.world.pending.delete(id);
    });
  }

  subscribe(host: { email: string; userId: string }): Promise<ProviderSubscription> {
    return this.run("subscribe", () => {
      const hostEmail = host.email;
      this.world.host(hostEmail);
      const remoteName = `subscriptions/fake-${host.userId}`;
      const expiresAt = new Date(this.world.now().getTime() + this.world.subscriptionLifetimeMs);
      this.world.subscriptions.set(remoteName, { hostEmail, expiresAt });
      return { remoteName, expiresAt };
    });
  }

  renewSubscription(hostEmail: string, remoteName: string): Promise<ProviderSubscription> {
    return this.run("renewSubscription", () => {
      const sub = this.world.subscriptions.get(remoteName);
      if (sub?.hostEmail !== hostEmail) throw new ProviderNotFoundError("No such subscription.");
      sub.expiresAt = new Date(this.world.now().getTime() + this.world.subscriptionLifetimeMs);
      return { remoteName, expiresAt: sub.expiresAt };
    });
  }

  storageUsage(hostEmail: string): Promise<{ usedBytes: number; limitBytes: number | null }> {
    return this.run("storageUsage", () => {
      const { usedBytes, limitBytes } = this.world.host(hostEmail);
      return { usedBytes, limitBytes };
    });
  }

  health(hostEmail: string): Promise<ProviderHealth> {
    const failure = this.world.take("health");
    this.world.host(hostEmail);
    return Promise.resolve(
      failure === null ? { ok: true, detail: null } : { ok: false, detail: `Fake: ${failure}` },
    );
  }
}
