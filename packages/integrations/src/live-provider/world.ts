import { encodeMeetEnvelope } from "../google/events";
import type {
  DialIn,
  ParticipantKind,
  ProviderEventType,
  RawProviderEnvelope,
  SpaceSettings,
} from "./port";

/**
 * An in-memory Meet + Drive + event transport (TRD §21.3). `FakeLiveProvider` reads it directly
 * and `FakeGoogleServer` serves it over HTTP, so one contract suite drives both. Tests script it
 * through the driver methods (start a conference, add a participant, …) and `failNext`.
 */

export interface WorldSpace {
  spaceId: string;
  hostEmail: string;
  meetingCode: string;
  joinUrl: string;
  settings: SpaceSettings;
  members: Map<string, "COHOST" | "MEMBER">;
  activeConferenceId: string | null;
}

export interface WorldConference {
  conferenceId: string;
  spaceId: string;
  startedAt: Date;
  endedAt: Date | null;
}

export interface WorldSession {
  participantId: string;
  sessionId: string;
  kind: ParticipantKind;
  providerUserId: string | null;
  displayName: string | null;
  email: string | null;
  startedAt: Date;
  endedAt: Date | null;
}

export interface WorldRecording {
  recordingId: string;
  conferenceId: string;
  state: "STARTED" | "ENDED" | "FILE_GENERATED";
  startedAt: Date;
  endedAt: Date | null;
  fileId: string | null;
}

export interface WorldFile {
  fileId: string;
  ownerEmail: string;
  bytes: Buffer;
  mime: string;
  durationMs: number | null;
  trashed: boolean;
}

export type WorldFailure = "unavailable" | "permanent" | "notfound";

export class MeetWorld {
  readonly hosts = new Map<
    string,
    { userId: string; usedBytes: number; limitBytes: number | null }
  >();
  readonly spaces = new Map<string, WorldSpace>();
  readonly conferences = new Map<string, WorldConference>();
  readonly sessions = new Map<string, WorldSession[]>();
  readonly recordings = new Map<string, WorldRecording[]>();
  readonly files = new Map<string, WorldFile>();
  readonly subscriptions = new Map<string, { hostEmail: string; expiresAt: Date }>();
  /** Delivered but not yet acknowledged, by ack id. */
  readonly pending = new Map<string, RawProviderEnvelope>();
  /** Every operation asked of the world, in order (INV-8 tests assert none ran in a request). */
  readonly calls: string[] = [];
  dialIn: DialIn | null = { numbers: [{ region: "NG", phone: "+234 1 000 0000", pin: "123456" }] };
  subscriptionLifetimeMs = 7 * 86_400_000;
  /** Permissions (scopes) the Workspace admin hasn't granted. */
  readonly deniedPermissions = new Set<string>();
  private readonly failures = new Map<string, WorldFailure[]>();
  private seq = 0;

  constructor(readonly now: () => Date = () => new Date()) {}

  private id(prefix: string): string {
    this.seq++;
    return `${prefix}${this.seq.toString(36).padStart(4, "0")}`;
  }

  /** Registers a host account (the fakes accept any host, creating it on first use). */
  host(email: string) {
    let host = this.hosts.get(email);
    if (host === undefined) {
      host = { userId: String(100_000 + this.hosts.size), usedBytes: 0, limitBytes: 2 ** 40 };
      this.hosts.set(email, host);
    }
    return host;
  }

  /** The next call of `op` fails as given (several calls queue up). */
  failNext(op: string, failure: WorldFailure, times = 1): this {
    const queue = this.failures.get(op) ?? [];
    for (let i = 0; i < times; i++) queue.push(failure);
    this.failures.set(op, queue);
    return this;
  }

  /** Records the call and returns the scripted failure for it, if any. */
  take(op: string): WorldFailure | null {
    this.calls.push(op);
    const queue = this.failures.get(op);
    return queue?.shift() ?? null;
  }

  // ---- operations (what the provider can do) ----

  createSpace(hostEmail: string, settings: SpaceSettings): WorldSpace {
    this.host(hostEmail);
    const spaceId = this.id("sp");
    const letters = (n: number) =>
      Array.from({ length: n }, (_, i) => String.fromCharCode(97 + ((this.seq * 7 + i) % 26))).join(
        "",
      );
    const meetingCode = `${letters(3)}-${letters(4)}-${letters(3)}`;
    const space: WorldSpace = {
      spaceId,
      hostEmail,
      meetingCode,
      joinUrl: `https://meet.google.com/${meetingCode}`,
      settings,
      members: new Map(),
      activeConferenceId: null,
    };
    this.spaces.set(spaceId, space);
    return space;
  }

  space(spaceId: string): WorldSpace | undefined {
    return this.spaces.get(spaceId);
  }

  conferencesOf(spaceId: string): WorldConference[] {
    return [...this.conferences.values()].filter((c) => c.spaceId === spaceId);
  }

  // ---- driver (what happens in Meet) ----

  startConference(spaceId: string, at = this.now()): string {
    const space = this.spaces.get(spaceId);
    if (space === undefined) throw new Error(`No space ${spaceId}`);
    const conferenceId = this.id("cr");
    this.conferences.set(conferenceId, { conferenceId, spaceId, startedAt: at, endedAt: null });
    space.activeConferenceId = conferenceId;
    this.emit("CONFERENCE_STARTED", space.hostEmail, at, { conferenceId });
    return conferenceId;
  }

  endConference(conferenceId: string, at = this.now()): void {
    const conference = this.conferences.get(conferenceId);
    if (conference === undefined) throw new Error(`No conference ${conferenceId}`);
    conference.endedAt = at;
    const space = this.spaces.get(conference.spaceId);
    if (space?.activeConferenceId === conferenceId) space.activeConferenceId = null;
    for (const s of this.sessions.get(conferenceId) ?? []) s.endedAt ??= at;
    this.emit("CONFERENCE_ENDED", space?.hostEmail ?? "", at, { conferenceId });
  }

  addSession(
    conferenceId: string,
    input: {
      participantId?: string;
      kind?: ParticipantKind;
      providerUserId?: string | null;
      displayName?: string | null;
      email?: string | null;
      startedAt: Date;
      endedAt?: Date | null;
    },
  ): WorldSession {
    const conference = this.conferences.get(conferenceId);
    if (conference === undefined) throw new Error(`No conference ${conferenceId}`);
    const session: WorldSession = {
      participantId: input.participantId ?? this.id("p"),
      sessionId: this.id("ps"),
      kind: input.kind ?? "SIGNED_IN",
      providerUserId: input.providerUserId ?? null,
      displayName: input.displayName ?? null,
      email: input.email ?? null,
      startedAt: input.startedAt,
      endedAt: input.endedAt ?? null,
    };
    const list = this.sessions.get(conferenceId) ?? [];
    list.push(session);
    this.sessions.set(conferenceId, list);
    const space = this.spaces.get(conference.spaceId);
    this.emit("PARTICIPANT_JOINED", space?.hostEmail ?? "", input.startedAt, {
      conferenceId,
      participant: { participantId: session.participantId, sessionId: session.sessionId },
    });
    return session;
  }

  /** A recording file lands in the host's Drive (state FILE_GENERATED) and the event fires. */
  addRecording(
    conferenceId: string,
    input: { bytes: Buffer; durationMs: number | null; mime?: string; startedAt?: Date },
  ): WorldRecording {
    const conference = this.conferences.get(conferenceId);
    if (conference === undefined) throw new Error(`No conference ${conferenceId}`);
    const space = this.spaces.get(conference.spaceId);
    const hostEmail = space?.hostEmail ?? "";
    const fileId = this.id("f");
    this.files.set(fileId, {
      fileId,
      ownerEmail: hostEmail,
      bytes: input.bytes,
      mime: input.mime ?? "video/mp4",
      durationMs: input.durationMs,
      trashed: false,
    });
    this.host(hostEmail).usedBytes += input.bytes.length;
    const recording: WorldRecording = {
      recordingId: this.id("rec"),
      conferenceId,
      state: "FILE_GENERATED",
      startedAt: input.startedAt ?? conference.startedAt,
      endedAt: conference.endedAt ?? this.now(),
      fileId,
    };
    const list = this.recordings.get(conferenceId) ?? [];
    list.push(recording);
    this.recordings.set(conferenceId, list);
    this.emit("RECORDING_READY", hostEmail, this.now(), {
      conferenceId,
      recordingId: recording.recordingId,
    });
    return recording;
  }

  /** Someone deleted the file in Drive. */
  deleteFile(fileId: string): void {
    this.files.delete(fileId);
  }

  /** Queues a transport message (the drivers above call this; tests can too). */
  emit(
    type: ProviderEventType,
    hostEmail: string,
    at: Date,
    extra: {
      conferenceId?: string;
      recordingId?: string;
      participant?: { participantId: string; sessionId: string };
      subscription?: string;
    } = {},
  ): RawProviderEnvelope {
    const envelope = encodeMeetEnvelope({
      messageId: this.id("msg"),
      type,
      at,
      hostUserId: this.host(hostEmail).userId,
      ...extra,
    });
    this.pending.set(this.id("ack"), envelope);
    return envelope;
  }

  /** Drops queued messages (an event lost in transport). */
  dropPending(): void {
    this.pending.clear();
  }
}
