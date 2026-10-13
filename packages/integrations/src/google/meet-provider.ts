import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  ProviderNotFoundError,
  ProviderUnavailableError,
  type ArtifactMetadata,
  type ArtifactStream,
  type LiveProvider,
  type ParticipantKind,
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
} from "../live-provider/port";
import { SCOPES, ServiceAccountTokens, type FetchLike, type ServiceAccount } from "./auth";
import type { BreakerState } from "./breaker";
import { GoogleClient } from "./client";
import { MEET_EVENT_TYPES, parseMeetEnvelope } from "./events";
import type { GoogleRateLimiter } from "./limiter";

export interface GoogleEndpoints {
  token: string;
  meet: string;
  drive: string;
  events: string;
  pubsub: string;
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  token: "https://oauth2.googleapis.com/token",
  meet: "https://meet.googleapis.com/v2",
  drive: "https://www.googleapis.com/drive/v3",
  events: "https://workspaceevents.googleapis.com/v1",
  pubsub: "https://pubsub.googleapis.com/v1",
};

export interface GoogleMeetOptions {
  serviceAccount: ServiceAccount;
  /** `projects/<p>/subscriptions/<s>` (pull). */
  pubsubSubscription: string;
  /** `projects/<p>/topics/<t>`: where Workspace Events publish. */
  pubsubTopic: string;
  endpoints?: Partial<GoogleEndpoints>;
  fetch?: FetchLike;
  limiter?: GoogleRateLimiter;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  /** Subscription create/renew are long-running operations; how often to poll them. */
  operationPollMs?: number;
}

const MEET_WRITE = [SCOPES.meetCreated];
const MEET_READ = [SCOPES.meetReadonly];

interface Page<K extends string, T> {
  nextPageToken?: string;
  [key: string]: unknown;
  items?: Record<K, T>;
}

interface MeetSpace {
  name: string;
  meetingUri?: string;
  meetingCode?: string;
  activeConference?: { conferenceRecord?: string };
}

interface MeetConference {
  name: string;
  startTime: string;
  endTime?: string;
  space: string;
}

interface MeetParticipant {
  name: string;
  signedinUser?: { user?: string; displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
}

interface MeetRecording {
  name: string;
  state?: string;
  startTime?: string;
  endTime?: string;
  driveDestination?: { file?: string };
}

interface Operation<T> {
  name: string;
  done?: boolean;
  response?: T;
  error?: { message?: string };
}

interface EventSubscription {
  name: string;
  expireTime?: string;
}

const last = (name: string) => name.slice(name.lastIndexOf("/") + 1);
const date = (value: string | undefined) => (value === undefined ? null : new Date(value));

/**
 * The Google Meet adapter (TRD §11, WP-MEET-2): Meet REST v2 for spaces, members, conferences,
 * participants and recordings; Drive v3 for recording files; Workspace Events v1 for one
 * subscription per host account; Pub/Sub v1 pull for the events. It acts as a host account
 * through domain-wide delegation, except for Pub/Sub, where the service account acts as itself.
 */
export class GoogleMeetProvider implements LiveProvider {
  readonly name = "google_meet" as const;
  private readonly client: GoogleClient;
  private readonly endpoints: GoogleEndpoints;

  constructor(private readonly options: GoogleMeetOptions) {
    this.endpoints = { ...GOOGLE_ENDPOINTS, ...options.endpoints };
    const tokens = new ServiceAccountTokens(options.serviceAccount, {
      tokenUrl: this.endpoints.token,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    this.client = new GoogleClient(tokens, {
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      ...(options.random === undefined ? {} : { random: options.random }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  breakerStates(): Record<string, BreakerState> {
    return this.client.breakerStates();
  }

  private meet(path: string) {
    return `${this.endpoints.meet}/${path}`;
  }

  /** Every page of a list endpoint. */
  private async *pages<T>(
    subject: string,
    url: string,
    key: string,
    scopes: readonly string[],
  ): AsyncIterable<T> {
    let pageToken: string | undefined;
    do {
      const u = new URL(url);
      if (pageToken !== undefined) u.searchParams.set("pageToken", pageToken);
      const page = await this.client.json<Page<string, T>>({
        method: "GET",
        url: u.toString(),
        subject,
        scopes,
        quota: "read",
      });
      for (const item of (page[key] as T[] | undefined) ?? []) yield item;
      pageToken = page.nextPageToken === "" ? undefined : page.nextPageToken;
    } while (pageToken !== undefined);
  }

  async provisionSpace(input: ProvisionInput): Promise<ProvisionedSpace> {
    const { settings } = input;
    const space = await this.client.json<MeetSpace>({
      method: "POST",
      url: this.meet("spaces"),
      subject: input.hostEmail,
      scopes: MEET_WRITE,
      quota: "create",
      json: {
        config: {
          accessType: settings.accessType,
          entryPointAccess: "ALL",
          moderation: settings.moderation ? "ON" : "OFF",
          moderationRestrictions: { presentRestriction: settings.presentRestriction },
          attendanceReportGenerationType: "DO_NOT_GENERATE",
          artifactConfig: {
            recordingConfig: { autoRecordingGeneration: settings.autoRecording ? "ON" : "OFF" },
            transcriptionConfig: { autoTranscriptionGeneration: "OFF" },
            smartNotesConfig: { autoSmartNotesGeneration: "OFF" },
          },
        },
      },
    });
    if (space.meetingUri === undefined || space.meetingCode === undefined)
      throw new ProviderUnavailableError("Google created a space without a meeting link.");
    // Meet's REST API doesn't report dial-in numbers (S-02); /join then offers none.
    return {
      spaceId: last(space.name),
      joinUrl: space.meetingUri,
      meetingCode: space.meetingCode,
      dialIn: null,
    };
  }

  async syncAccess(input: SyncAccessInput): Promise<SyncAccessResult> {
    const subject = input.space.hostEmail;
    const base = this.meet(`spaces/${input.space.spaceId}/members`);
    const want = new Map<string, "COHOST" | "MEMBER">();
    for (const email of input.members) want.set(email.toLowerCase(), "MEMBER");
    for (const email of input.cohosts) want.set(email.toLowerCase(), "COHOST");

    const have = new Map<string, { name: string; role: string }>();
    for await (const member of this.pages<{ name: string; email?: string; role?: string }>(
      subject,
      base,
      "members",
      MEET_WRITE,
    ))
      if (member.email !== undefined)
        have.set(member.email.toLowerCase(), { name: member.name, role: member.role ?? "MEMBER" });

    let added = 0;
    let removed = 0;
    const failed: SyncAccessResult["failed"] = [];
    for (const [email, current] of have) {
      if (want.get(email) === current.role) continue;
      // A member whose role changed is removed and added again.
      await this.client.send({
        method: "DELETE",
        url: `${this.endpoints.meet}/${current.name}`,
        subject,
        scopes: MEET_WRITE,
        quota: "write",
        accept: [404],
      });
      if (!want.has(email)) removed++;
      have.delete(email);
    }
    for (const [email, role] of want) {
      if (have.has(email)) continue;
      const response = await this.client.send({
        method: "POST",
        url: base,
        subject,
        scopes: MEET_WRITE,
        quota: "write",
        json: role === "COHOST" ? { email, role } : { email },
        accept: [400, 409],
      });
      if (response.status === 400) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        failed.push({ email, reason: body.error?.message?.slice(0, 200) ?? "Refused by Google." });
      } else {
        await response.body?.cancel();
        added++;
      }
    }
    return { added, removed, failed };
  }

  async getSpaceStatus(ref: ProviderSpaceRef): Promise<ProviderSpaceStatus> {
    const space = await this.client.json<MeetSpace>({
      method: "GET",
      url: this.meet(`spaces/${ref.spaceId}`),
      subject: ref.hostEmail,
      scopes: MEET_WRITE,
      quota: "read",
    });
    const record = space.activeConference?.conferenceRecord;
    return { activeConferenceId: record === undefined ? null : last(record) };
  }

  async endActiveConference(ref: ProviderSpaceRef): Promise<void> {
    // 400/412: there is no active conference, which is what ending wants anyway.
    const response = await this.client.send({
      method: "POST",
      url: this.meet(`spaces/${ref.spaceId}:endActiveConference`),
      subject: ref.hostEmail,
      scopes: MEET_WRITE,
      quota: "write",
      json: {},
      accept: [400, 412],
    });
    await response.body?.cancel();
  }

  async listConferences(ref: ProviderSpaceRef): Promise<ProviderConference[]> {
    const url = new URL(this.meet("conferenceRecords"));
    url.searchParams.set("filter", `space.name = "spaces/${ref.spaceId}"`);
    const out: ProviderConference[] = [];
    for await (const c of this.pages<MeetConference>(
      ref.hostEmail,
      url.toString(),
      "conferenceRecords",
      MEET_READ,
    ))
      out.push({
        conferenceId: last(c.name),
        startedAt: new Date(c.startTime),
        endedAt: date(c.endTime),
      });
    return out.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  }

  async getConference(
    ref: ProviderConferenceRef,
  ): Promise<ProviderConference & { spaceId: string }> {
    const c = await this.client.json<MeetConference>({
      method: "GET",
      url: this.meet(`conferenceRecords/${ref.conferenceId}`),
      subject: ref.hostEmail,
      scopes: MEET_READ,
      quota: "read",
    });
    return {
      conferenceId: last(c.name),
      startedAt: new Date(c.startTime),
      endedAt: date(c.endTime),
      spaceId: last(c.space),
    };
  }

  async *listParticipantSessions(
    conf: ProviderConferenceRef,
  ): AsyncIterable<ProviderParticipantSession> {
    const participants: MeetParticipant[] = [];
    for await (const p of this.pages<MeetParticipant>(
      conf.hostEmail,
      this.meet(`conferenceRecords/${conf.conferenceId}/participants`),
      "participants",
      MEET_READ,
    ))
      participants.push(p);
    for (const p of participants) {
      const kind: ParticipantKind =
        p.signedinUser !== undefined
          ? "SIGNED_IN"
          : p.phoneUser !== undefined
            ? "PHONE"
            : "ANONYMOUS";
      const who = p.signedinUser ?? p.phoneUser ?? p.anonymousUser;
      for await (const s of this.pages<{ name: string; startTime?: string; endTime?: string }>(
        conf.hostEmail,
        `${this.endpoints.meet}/${p.name}/participantSessions`,
        "participantSessions",
        MEET_READ,
      )) {
        if (s.startTime === undefined) continue;
        yield {
          participantId: last(p.name),
          sessionId: last(s.name),
          kind,
          providerUserId: p.signedinUser?.user ?? null,
          displayName: who?.displayName ?? null,
          startedAt: new Date(s.startTime),
          endedAt: date(s.endTime),
          raw: { participant: p, session: s },
        };
      }
    }
  }

  async listRecordings(conf: ProviderConferenceRef): Promise<ProviderRecording[]> {
    const out: ProviderRecording[] = [];
    for await (const r of this.pages<MeetRecording>(
      conf.hostEmail,
      this.meet(`conferenceRecords/${conf.conferenceId}/recordings`),
      "recordings",
      MEET_READ,
    ))
      out.push({
        recordingId: last(r.name),
        state:
          r.state === "FILE_GENERATED"
            ? "FILE_GENERATED"
            : r.state === "ENDED"
              ? "ENDED"
              : "STARTED",
        startedAt: date(r.startTime),
        endedAt: date(r.endTime),
        fileId: r.driveDestination?.file === undefined ? null : last(r.driveDestination.file),
      });
    return out;
  }

  async describeArtifact(ref: ProviderArtifactRef): Promise<ArtifactMetadata> {
    const url = new URL(`${this.endpoints.drive}/files/${ref.fileId}`);
    url.searchParams.set("fields", "id,size,md5Checksum,mimeType,trashed,videoMediaMetadata");
    url.searchParams.set("supportsAllDrives", "true");
    try {
      const file = await this.client.json<{
        size?: string;
        md5Checksum?: string;
        mimeType?: string;
        trashed?: boolean;
        videoMediaMetadata?: { durationMillis?: string };
      }>({
        method: "GET",
        url: url.toString(),
        subject: ref.hostEmail,
        scopes: [SCOPES.driveMeet],
      });
      if (file.trashed === true)
        return { exists: false, sizeBytes: null, md5: null, mime: null, durationMs: null };
      const duration = file.videoMediaMetadata?.durationMillis;
      return {
        exists: true,
        sizeBytes: file.size === undefined ? null : Number(file.size),
        md5: file.md5Checksum ?? null,
        mime: file.mimeType ?? null,
        durationMs: duration === undefined ? null : Number(duration),
      };
    } catch (error) {
      if (error instanceof ProviderNotFoundError)
        return { exists: false, sizeBytes: null, md5: null, mime: null, durationMs: null };
      throw error;
    }
  }

  async openArtifactStream(
    ref: ProviderArtifactRef,
    opts: { rangeStart?: number } = {},
  ): Promise<ArtifactStream> {
    const url = new URL(`${this.endpoints.drive}/files/${ref.fileId}`);
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");
    const start = opts.rangeStart ?? 0;
    const response = await this.client.send({
      method: "GET",
      url: url.toString(),
      subject: ref.hostEmail,
      scopes: [SCOPES.driveMeet],
      ...(start > 0 ? { headers: { range: `bytes=${String(start)}-` } } : {}),
    });
    if (response.body === null) throw new ProviderUnavailableError("Drive sent no file body.");
    if (start > 0 && response.status !== 206) {
      await response.body.cancel();
      throw new ProviderUnavailableError("Drive ignored the byte range.");
    }
    return {
      body: Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
      sizeBytes: Number(response.headers.get("content-length") ?? "0"),
    };
  }

  async trashArtifact(ref: ProviderArtifactRef): Promise<void> {
    const response = await this.client.send({
      method: "PATCH",
      url: `${this.endpoints.drive}/files/${ref.fileId}?supportsAllDrives=true`,
      subject: ref.hostEmail,
      scopes: [SCOPES.drive],
      json: { trashed: true },
    });
    await response.body?.cancel();
  }

  parseEvent(envelope: RawProviderEnvelope): ProviderEvent | null {
    return parseMeetEnvelope(envelope);
  }

  async pullEvents(max: number): Promise<PulledEvent[]> {
    const body = await this.client.json<{
      receivedMessages?: {
        ackId: string;
        message: {
          messageId: string;
          data?: string;
          attributes?: Record<string, string>;
          publishTime: string;
        };
      }[];
    }>({
      method: "POST",
      url: `${this.endpoints.pubsub}/${this.options.pubsubSubscription}:pull`,
      subject: null,
      scopes: [SCOPES.pubsub],
      json: { maxMessages: max },
    });
    return (body.receivedMessages ?? []).map(({ ackId, message }) => ({
      ackId,
      envelope: {
        messageId: message.messageId,
        attributes: message.attributes ?? {},
        data: message.data ?? "",
        publishTime: message.publishTime,
      },
    }));
  }

  async ackEvents(ackIds: string[]): Promise<void> {
    if (ackIds.length === 0) return;
    await this.client.json({
      method: "POST",
      url: `${this.endpoints.pubsub}/${this.options.pubsubSubscription}:acknowledge`,
      subject: null,
      scopes: [SCOPES.pubsub],
      json: { ackIds },
    });
  }

  /** Waits for a Workspace Events long-running operation (create/renew) and returns its result. */
  private async settle(
    hostEmail: string,
    op: Operation<EventSubscription>,
  ): Promise<ProviderSubscription> {
    const sleep =
      this.options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let current = op;
    for (let i = 0; current.done !== true && i < 10; i++) {
      await sleep(this.options.operationPollMs ?? 1000);
      current = await this.client.json<Operation<EventSubscription>>({
        method: "GET",
        url: `${this.endpoints.events}/${current.name}`,
        subject: hostEmail,
        scopes: MEET_READ,
      });
    }
    if (current.error !== undefined)
      throw new ProviderUnavailableError(
        `Subscription operation failed: ${current.error.message ?? "unknown"}`,
      );
    const sub = current.response;
    if (current.done !== true || sub === undefined)
      throw new ProviderUnavailableError("The subscription operation hasn't finished yet.");
    return {
      remoteName: sub.name,
      expiresAt: new Date(sub.expireTime ?? Date.now()),
    };
  }

  async subscribe(host: { email: string; userId: string }): Promise<ProviderSubscription> {
    const op = await this.client.json<Operation<EventSubscription>>({
      method: "POST",
      url: `${this.endpoints.events}/subscriptions`,
      subject: host.email,
      scopes: MEET_READ,
      json: {
        targetResource: `//cloudidentity.googleapis.com/users/${host.userId}`,
        eventTypes: MEET_EVENT_TYPES,
        notificationEndpoint: { pubsubTopic: this.options.pubsubTopic },
        payloadOptions: { includeResource: false },
      },
    });
    return this.settle(host.email, op);
  }

  async renewSubscription(hostEmail: string, remoteName: string): Promise<ProviderSubscription> {
    // A TTL of 0 asks for the longest lifetime the event types allow.
    const op = await this.client.json<Operation<EventSubscription>>({
      method: "PATCH",
      url: `${this.endpoints.events}/${remoteName}?updateMask=ttl`,
      subject: hostEmail,
      scopes: MEET_READ,
      json: { ttl: "0s" },
    });
    return this.settle(hostEmail, op);
  }

  async storageUsage(hostEmail: string): Promise<{ usedBytes: number; limitBytes: number | null }> {
    const about = await this.client.json<{ storageQuota?: { usage?: string; limit?: string } }>({
      method: "GET",
      url: `${this.endpoints.drive}/about?fields=storageQuota`,
      subject: hostEmail,
      scopes: [SCOPES.driveMeet],
    });
    const quota = about.storageQuota ?? {};
    return {
      usedBytes: Number(quota.usage ?? "0"),
      limitBytes: quota.limit === undefined ? null : Number(quota.limit),
    };
  }

  async health(hostEmail: string): Promise<ProviderHealth> {
    try {
      await this.storageUsage(hostEmail);
      return { ok: true, detail: null };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
