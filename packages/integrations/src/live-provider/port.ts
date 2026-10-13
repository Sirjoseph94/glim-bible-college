import type { Readable } from "node:stream";

/**
 * The live-class provider (TRD §11.1): creates the online space for a Class Meeting, lets the
 * right people in, and reports what happened in it. Domain-neutral types only; modules import
 * this file, never an adapter (INV-3). Every reference is an opaque string the adapter made,
 * stored as-is; the host account that owns a space travels with each reference because the
 * provider acts as that account.
 */

/** A space, owned by a host account. */
export interface ProviderSpaceRef {
  hostEmail: string;
  spaceId: string;
}

/** One conference (a continuous call) held in a space. */
export interface ProviderConferenceRef {
  hostEmail: string;
  conferenceId: string;
}

/** A recording file in the host account's storage. */
export interface ProviderArtifactRef {
  hostEmail: string;
  fileId: string;
}

export interface DialIn {
  numbers: { region: string; phone: string; pin: string }[];
}

/** How the space is configured (from `policies[GOOGLE_MEET]`, §11.5). */
export interface SpaceSettings {
  accessType: "RESTRICTED" | "TRUSTED" | "OPEN";
  moderation: boolean;
  presentRestriction: "HOSTS_ONLY" | "ANYONE";
  autoRecording: boolean;
}

export interface ProvisionInput {
  hostEmail: string;
  settings: SpaceSettings;
}

export interface ProvisionedSpace {
  spaceId: string;
  joinUrl: string;
  meetingCode: string;
  dialIn: DialIn | null;
}

export interface SyncAccessInput {
  space: ProviderSpaceRef;
  /** Lecturers: can admit, mute, present and record. */
  cohosts: string[];
  /** Enrolled students: join without knocking. */
  members: string[];
}

export interface SyncAccessResult {
  added: number;
  removed: number;
  /** Emails the provider refused, with its reason. */
  failed: { email: string; reason: string }[];
}

export interface ProviderSpaceStatus {
  activeConferenceId: string | null;
}

export interface ProviderConference {
  conferenceId: string;
  startedAt: Date;
  endedAt: Date | null;
}

export type ParticipantKind = "SIGNED_IN" | "ANONYMOUS" | "PHONE";

/** One join-to-leave stretch of one participant (raw evidence, INV-7). */
export interface ProviderParticipantSession {
  participantId: string;
  sessionId: string;
  kind: ParticipantKind;
  /** The provider's stable user id (signed-in participants only). */
  providerUserId: string | null;
  displayName: string | null;
  startedAt: Date;
  endedAt: Date | null;
  raw: Record<string, unknown>;
}

export interface ProviderRecording {
  recordingId: string;
  state: "STARTED" | "ENDED" | "FILE_GENERATED";
  startedAt: Date | null;
  endedAt: Date | null;
  /** Set once the file exists. */
  fileId: string | null;
}

export interface ArtifactMetadata {
  exists: boolean;
  sizeBytes: number | null;
  md5: string | null;
  mime: string | null;
  durationMs: number | null;
}

export interface ArtifactStream {
  body: Readable;
  /** Bytes in `body` (from `rangeStart` to the end). */
  sizeBytes: number;
}

/** A message as the event transport delivered it (Pub/Sub). */
export interface RawProviderEnvelope {
  messageId: string;
  attributes: Record<string, string>;
  /** base64 */
  data: string;
  publishTime: string;
}

export type ProviderEventType =
  | "CONFERENCE_STARTED"
  | "CONFERENCE_ENDED"
  | "PARTICIPANT_JOINED"
  | "PARTICIPANT_LEFT"
  | "RECORDING_READY"
  | "SUBSCRIPTION_LIFECYCLE";

/** A provider event reduced to resource names (§11.8: events are hints). */
export interface ProviderEvent {
  eventId: string;
  type: ProviderEventType;
  occurredAt: Date;
  /** The space the event is about, when the provider says (else resolve via the conference). */
  spaceId: string | null;
  conferenceId: string | null;
  recordingId: string | null;
  /** The subscription it came through (lifecycle events). */
  subscription: string | null;
}

export interface PulledEvent {
  ackId: string;
  envelope: RawProviderEnvelope;
}

export interface ProviderSubscription {
  remoteName: string;
  expiresAt: Date;
}

export interface ProviderHealth {
  ok: boolean;
  detail: string | null;
}

export interface LiveProvider {
  readonly name: "google_meet" | "fake";
  provisionSpace(input: ProvisionInput): Promise<ProvisionedSpace>;
  /** Makes the members exactly `cohosts` + `members` (idempotent). */
  syncAccess(input: SyncAccessInput): Promise<SyncAccessResult>;
  getSpaceStatus(ref: ProviderSpaceRef): Promise<ProviderSpaceStatus>;
  endActiveConference(ref: ProviderSpaceRef): Promise<void>;
  listConferences(ref: ProviderSpaceRef): Promise<ProviderConference[]>;
  getConference(ref: ProviderConferenceRef): Promise<ProviderConference & { spaceId: string }>;
  listParticipantSessions(conf: ProviderConferenceRef): AsyncIterable<ProviderParticipantSession>;
  listRecordings(conf: ProviderConferenceRef): Promise<ProviderRecording[]>;
  describeArtifact(ref: ProviderArtifactRef): Promise<ArtifactMetadata>;
  openArtifactStream(
    ref: ProviderArtifactRef,
    opts?: { rangeStart?: number },
  ): Promise<ArtifactStream>;
  /** Drive cleanup (C-16; off by default, D-07). */
  trashArtifact(ref: ProviderArtifactRef): Promise<void>;
  /** Reduces a transport message to an event, or null if it isn't one this app routes. */
  parseEvent(envelope: RawProviderEnvelope): ProviderEvent | null;
  /** Event transport (§11.8): pull, then ack only after the inbox insert commits. */
  pullEvents(max: number): Promise<PulledEvent[]>;
  ackEvents(ackIds: string[]): Promise<void>;
  /**
   * One event subscription per host account (S-04). `hostUserId` is the account's numeric
   * directory id: the subscription's target is the user, not an email.
   */
  subscribe(host: { email: string; userId: string }): Promise<ProviderSubscription>;
  renewSubscription(hostEmail: string, remoteName: string): Promise<ProviderSubscription>;
  /** The host account's storage use (§11.2: alert at 70 % / 85 %). Limit null = unlimited. */
  storageUsage(hostEmail: string): Promise<{ usedBytes: number; limitBytes: number | null }>;
  /** Whether the provider can act as the host account at all (token + a cheap read). */
  health(hostEmail: string): Promise<ProviderHealth>;
}

/** The provider couldn't be asked (network, 5xx, 429 after retries): try again later. */
export class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number | null = null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderUnavailableError";
  }
}

/** The provider refused for good (403: scopes, suspended account). Retrying won't help. */
export class ProviderPermanentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderPermanentError";
  }
}

/** The thing asked about doesn't exist (a recording file deleted from Drive: SOURCE_MISSING). */
export class ProviderNotFoundError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderNotFoundError";
  }
}

/** The local quota limiter would wait longer than allowed: reschedule the job instead (§11.7). */
export class ProviderRateLimitedError extends Error {
  constructor(readonly waitMs: number) {
    super(`Rate limited; retry in ${String(waitMs)} ms.`);
    this.name = "ProviderRateLimitedError";
  }
}

export const LIVE_PROVIDER = Symbol.for("glim.LiveProvider");
