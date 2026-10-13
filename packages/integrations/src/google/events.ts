import type { ProviderEvent, ProviderEventType, RawProviderEnvelope } from "../live-provider/port";

/**
 * Workspace Events → Pub/Sub messages (TRD §11.8, S-04): a CloudEvent in binary mode, so the
 * event's type, id, time, source and subject are message attributes (`ce-*`) and the data is
 * the JSON resource reference. Events carry resource names only.
 */

const TYPES: Record<string, ProviderEventType> = {
  "google.workspace.meet.conference.v2.started": "CONFERENCE_STARTED",
  "google.workspace.meet.conference.v2.ended": "CONFERENCE_ENDED",
  "google.workspace.meet.participant.v2.joined": "PARTICIPANT_JOINED",
  "google.workspace.meet.participant.v2.left": "PARTICIPANT_LEFT",
  "google.workspace.meet.recording.v2.fileGenerated": "RECORDING_READY",
  "google.workspace.events.subscription.v1.expirationReminder": "SUBSCRIPTION_LIFECYCLE",
  "google.workspace.events.subscription.v1.suspended": "SUBSCRIPTION_LIFECYCLE",
  "google.workspace.events.subscription.v1.expired": "SUBSCRIPTION_LIFECYCLE",
};

/** The Meet event types a subscription asks for. */
export const MEET_EVENT_TYPES = Object.keys(TYPES).filter((t) => t.includes(".meet."));

const CE_TYPE: Record<ProviderEventType, string> = {
  CONFERENCE_STARTED: "google.workspace.meet.conference.v2.started",
  CONFERENCE_ENDED: "google.workspace.meet.conference.v2.ended",
  PARTICIPANT_JOINED: "google.workspace.meet.participant.v2.joined",
  PARTICIPANT_LEFT: "google.workspace.meet.participant.v2.left",
  RECORDING_READY: "google.workspace.meet.recording.v2.fileGenerated",
  SUBSCRIPTION_LIFECYCLE: "google.workspace.events.subscription.v1.expirationReminder",
};

/** `conferenceRecords/abc/recordings/r1` → `{ conferenceRecords: "abc", recordings: "r1" }`. */
function segments(name: string): Record<string, string> {
  const parts = name.replace(/^\/\/[^/]+\//, "").split("/");
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < parts.length; i += 2) out[parts[i] as string] = parts[i + 1] as string;
  return out;
}

function resourceName(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  for (const value of Object.values(data as Record<string, unknown>)) {
    if (typeof value === "object" && value !== null && "name" in value) {
      const { name } = value;
      if (typeof name === "string") return name;
    }
  }
  return null;
}

export function parseMeetEnvelope(envelope: RawProviderEnvelope): ProviderEvent | null {
  const type = TYPES[envelope.attributes["ce-type"] ?? ""];
  if (type === undefined) return null;
  let data: unknown;
  try {
    const text = Buffer.from(envelope.data, "base64").toString("utf8");
    data = text === "" ? null : JSON.parse(text);
  } catch {
    return null;
  }
  const source = segments(envelope.attributes["ce-source"] ?? "");
  const name = resourceName(data) ?? envelope.attributes["ce-subject"] ?? "";
  const ids = segments(name);
  const time = new Date(envelope.attributes["ce-time"] ?? envelope.publishTime);
  return {
    eventId: envelope.attributes["ce-id"] ?? envelope.messageId,
    type,
    occurredAt: Number.isNaN(time.getTime()) ? new Date(envelope.publishTime) : time,
    spaceId: source.spaces ?? ids.spaces ?? null,
    conferenceId: ids.conferenceRecords ?? null,
    recordingId: ids.recordings ?? null,
    subscription: type === "SUBSCRIPTION_LIFECYCLE" ? (source.subscriptions ?? null) : null,
    hostUserId: source.users ?? null,
  };
}

/** Builds a message the way Workspace Events would publish it (the fakes use this). */
export function encodeMeetEnvelope(input: {
  messageId: string;
  type: ProviderEventType;
  at: Date;
  hostUserId: string;
  conferenceId?: string;
  recordingId?: string;
  participant?: { participantId: string; sessionId: string };
  subscription?: string;
}): RawProviderEnvelope {
  let data: Record<string, unknown>;
  if (input.type === "SUBSCRIPTION_LIFECYCLE")
    data = { subscription: { name: `subscriptions/${input.subscription ?? ""}` } };
  else if (input.type === "RECORDING_READY")
    data = {
      recording: {
        name: `conferenceRecords/${input.conferenceId ?? ""}/recordings/${input.recordingId ?? ""}`,
      },
    };
  else if (input.participant !== undefined)
    data = {
      participantSession: {
        name: `conferenceRecords/${input.conferenceId ?? ""}/participants/${input.participant.participantId}/participantSessions/${input.participant.sessionId}`,
      },
    };
  else data = { conferenceRecord: { name: `conferenceRecords/${input.conferenceId ?? ""}` } };
  return {
    messageId: input.messageId,
    publishTime: input.at.toISOString(),
    data: Buffer.from(JSON.stringify(data)).toString("base64"),
    attributes: {
      "ce-id": input.messageId,
      "ce-type": CE_TYPE[input.type],
      "ce-time": input.at.toISOString(),
      "ce-source":
        input.type === "SUBSCRIPTION_LIFECYCLE"
          ? `//workspaceevents.googleapis.com/subscriptions/${input.subscription ?? ""}`
          : `//cloudidentity.googleapis.com/users/${input.hostUserId}`,
      "ce-specversion": "1.0",
      "content-type": "application/json",
    },
  };
}
