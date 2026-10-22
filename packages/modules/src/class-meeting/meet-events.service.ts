import { joinWindowPolicy } from "@glim/contracts";
import { Db, schema, type Database, type TxQueue } from "@glim/db";
import {
  LIVE_PROVIDER,
  ProviderNotFoundError,
  type LiveProvider,
  type ProviderConference,
  type ProviderEvent,
  type RawProviderEnvelope,
} from "@glim/integrations/live-provider/port";
import { InboxService, type InboxEvent } from "@glim/modules/ops";
import { CLOCK, type Clock } from "@glim/shared";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import { MeetingLifecycleService } from "./lifecycle.service";

const MINUTE = 60_000;
/** Attendance is read again this long after a conference ends (§11.8 `conference.sync`). */
const RESYNC_AFTER_MS = 30 * MINUTE;
/** Reconciliation looks at classes from this long before their start (the staff window). */
const RECONCILE_FROM_MS = 60 * MINUTE;

type MeetingRow = typeof schema.classMeetings.$inferSelect;

/**
 * Meet events and reconciliation (owner: class-meeting, TRD §11.8, INV-6). Events are hints:
 * each one is routed to its Class Meeting, conference records are upserted, and the meeting
 * goes LIVE or ENDED through the state machine. The reconciliation sweep reads the same facts
 * from Meet directly, so a lost or late event is repaired within minutes.
 */
@Injectable()
export class MeetEventsService implements OnModuleInit {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(LIVE_PROVIDER) private readonly provider: LiveProvider | null,
    @Inject(InboxService) private readonly inbox: InboxService,
    @Inject(MeetingLifecycleService) private readonly lifecycle: MeetingLifecycleService,
  ) {}

  onModuleInit(): void {
    this.inbox.registerProcessor("google_meet", (event) => this.process(event));
  }

  /** Parses pulled messages for the inbox: resource names only, the raw message kept as-is. */
  toInbox(envelope: RawProviderEnvelope) {
    const event = this.provider?.parseEvent(envelope) ?? null;
    return {
      eventId: event?.eventId ?? envelope.messageId,
      eventType: event?.type ?? envelope.attributes["ce-type"] ?? "UNKNOWN",
      subject: event?.conferenceId ?? event?.spaceId ?? event?.subscription ?? null,
      payload: { ...envelope },
    };
  }

  /** The inbox processor for Google Meet events (§11.8 routing table). */
  async process(row: InboxEvent): Promise<"PROCESSED" | "IGNORED"> {
    const provider = this.provider;
    if (provider === null) return "IGNORED";
    const event = provider.parseEvent(row.payload as RawProviderEnvelope);
    if (event === null) return "IGNORED";

    if (event.type === "SUBSCRIPTION_LIFECYCLE") {
      if (event.subscription === null) return "IGNORED";
      await this.db.withTx(({ boss }) =>
        boss.send("subscription.renew", {
          remoteName: `subscriptions/${event.subscription ?? ""}`,
        }),
      );
      return "PROCESSED";
    }

    const routed = await this.route(event);
    if (routed === null) return "IGNORED";
    const { meeting, hostEmail } = routed;
    const conferenceId = event.conferenceId;
    if (conferenceId === null) return "IGNORED";

    switch (event.type) {
      case "CONFERENCE_STARTED": {
        const conference = await this.conference(hostEmail, conferenceId, event);
        await this.db.withTx(({ db }) => this.upsert(db, meeting.id, conference));
        await this.lifecycle.applyProviderEvent(
          meeting.id,
          "CONFERENCE_STARTED",
          conference.startedAt,
        );
        // Delivered after its own end (out of order): Meet already says it's over.
        if (conference.endedAt !== null) await this.endIfNoneActive(meeting, conference.endedAt);
        return "PROCESSED";
      }
      case "CONFERENCE_ENDED": {
        // The event carries no end time: ask Meet for it (§11.8).
        const conference = await this.conference(hostEmail, conferenceId, event);
        const ended = { ...conference, endedAt: conference.endedAt ?? event.occurredAt };
        await this.db.withTx(async ({ db, boss }) => {
          const recordId = await this.upsert(db, meeting.id, ended);
          await this.queueSyncs(boss, recordId);
        });
        await this.endIfNoneActive(meeting, ended.endedAt);
        return "PROCESSED";
      }
      case "PARTICIPANT_JOINED":
      case "PARTICIPANT_LEFT": {
        // Only a hint: attendance is read from Meet by conference.sync.
        const c = schema.conferenceRecords;
        const marked = await this.db.withTx(({ db }) =>
          db
            .update(c)
            .set({ dirty: true, updatedAt: this.clock.now() })
            .where(eq(c.providerConferenceId, conferenceId))
            .returning({ id: c.id }),
        );
        return marked.length > 0 ? "PROCESSED" : "IGNORED";
      }
      case "RECORDING_READY": {
        if (event.recordingId === null) return "IGNORED";
        await this.db.withTx(({ boss }) =>
          boss.send(
            "recording.discover",
            { meetingId: meeting.id, conferenceId, recordingId: event.recordingId },
            { singletonKey: `recording:${event.recordingId ?? ""}` },
          ),
        );
        return "PROCESSED";
      }
    }
  }

  /**
   * The `meeting.reconcile` job (every 3 minutes, §11.8): for each provisioned class that is
   * near, in or just after its time, lists the space's conferences in Meet, upserts them, and
   * applies any start or end the events didn't. One meeting's failure doesn't stop the rest.
   */
  async reconcile(): Promise<{ checked: number; started: number; ended: number }> {
    const provider = this.provider;
    const counts = { checked: 0, started: 0, ended: 0 };
    if (provider === null) return counts;
    const now = this.clock.now();
    const m = schema.classMeetings;
    const h = schema.providerHostAccounts;
    const rows = await this.db.read
      .select({ meeting: m, hostEmail: h.email })
      .from(m)
      .innerJoin(h, eq(h.id, m.hostAccountId))
      .where(
        and(
          eq(m.providerStatus, "READY"),
          sql`${m.providerSpaceId} IS NOT NULL`,
          sql`(
            (${m.state} IN ('SCHEDULED', 'OPEN') AND ${m.scheduledStart} <= ${new Date(now.getTime() + RECONCILE_FROM_MS)})
            OR ${m.state} = 'LIVE'
            OR (${m.state} = 'ENDED' AND ${m.finalizedAt} IS NULL)
          )`,
        ),
      );
    for (const { meeting, hostEmail } of rows) {
      const overrun = joinWindowPolicy.parse(
        (meeting.policySnapshot as { joinWindow?: { config?: unknown } }).joinWindow?.config ?? {},
      ).maxOverrunMinutes;
      // Past the overrun, a waiting class is the tick's (NO_SHOW/ENDED), not ours.
      if (
        now.getTime() > meeting.scheduledEnd.getTime() + overrun * MINUTE &&
        meeting.state !== "LIVE"
      )
        continue;
      counts.checked++;
      try {
        const conferences = await provider.listConferences({
          hostEmail,
          spaceId: meeting.providerSpaceId ?? "",
        });
        const fresh = await this.db.withTx(async ({ db, boss }) => {
          const c = schema.conferenceRecords;
          const known = new Map(
            (
              await db
                .select({ id: c.providerConferenceId, status: c.status })
                .from(c)
                .where(eq(c.classMeetingId, meeting.id))
            ).map((r) => [r.id, r.status]),
          );
          let newlyEnded = 0;
          for (const conference of conferences) {
            const recordId = await this.upsert(db, meeting.id, conference);
            if (conference.endedAt !== null && known.get(conference.conferenceId) !== "ENDED") {
              await this.queueSyncs(boss, recordId);
              newlyEnded++;
            }
          }
          return newlyEnded;
        });
        const active = conferences.filter((c) => c.endedAt === null);
        const first = active.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())[0];
        if (first !== undefined && meeting.state !== "LIVE") {
          if (
            (await this.lifecycle.applyProviderEvent(
              meeting.id,
              "CONFERENCE_STARTED",
              first.startedAt,
            )) === "LIVE"
          )
            counts.started++;
        } else if (active.length === 0 && meeting.state === "LIVE" && conferences.length > 0) {
          const lastEnd = Math.max(...conferences.map((c) => c.endedAt?.getTime() ?? 0));
          // Only an end we haven't applied: a Lecturer may have restarted the class since.
          if (lastEnd > (meeting.lastConferenceEndedAt?.getTime() ?? 0)) {
            if (
              (await this.lifecycle.applyProviderEvent(
                meeting.id,
                "CONFERENCE_ENDED",
                new Date(lastEnd),
              )) === "ENDED"
            )
              counts.ended++;
          }
        }
        if (fresh > 0) this.logger.info({ meetingId: meeting.id, fresh }, "reconciled conferences");
      } catch (error) {
        this.logger.warn({ err: error, meetingId: meeting.id }, "meeting reconciliation failed");
      }
    }
    return counts;
  }

  /** A conference record with its meeting and host, for `conference.sync` (attendance). */
  async conferenceForSync(conferenceRecordId: string): Promise<{
    record: typeof schema.conferenceRecords.$inferSelect;
    meeting: MeetingRow;
    hostEmail: string;
  } | null> {
    const c = schema.conferenceRecords;
    const m = schema.classMeetings;
    const h = schema.providerHostAccounts;
    const [row] = await this.db.read
      .select({ record: c, meeting: m, hostEmail: h.email })
      .from(c)
      .innerJoin(m, eq(m.id, c.classMeetingId))
      .innerJoin(h, eq(h.id, m.hostAccountId))
      .where(eq(c.id, conferenceRecordId));
    return row ?? null;
  }

  /** Attendance read the conference's participants: it is no longer dirty. */
  async markSynced(db: Database, conferenceRecordId: string): Promise<void> {
    const c = schema.conferenceRecords;
    const now = this.clock.now();
    await db
      .update(c)
      .set({ dirty: false, lastSyncedAt: now, updatedAt: now })
      .where(eq(c.id, conferenceRecordId));
  }

  // ---- helpers ----

  /** The meeting an event is about, and the host account that owns its space. */
  private async route(
    event: ProviderEvent,
  ): Promise<{ meeting: MeetingRow; hostEmail: string } | null> {
    const m = schema.classMeetings;
    const h = schema.providerHostAccounts;
    const c = schema.conferenceRecords;
    const select = () =>
      this.db.read
        .select({ meeting: m, hostEmail: h.email })
        .from(m)
        .innerJoin(h, eq(h.id, m.hostAccountId));
    if (event.spaceId !== null) {
      const [row] = await select().where(
        and(eq(m.provider, "google_meet"), eq(m.providerSpaceId, event.spaceId)),
      );
      if (row !== undefined) return row;
    }
    if (event.conferenceId === null) return null;
    const [known] = await select()
      .innerJoin(c, eq(c.classMeetingId, m.id))
      .where(eq(c.providerConferenceId, event.conferenceId));
    if (known !== undefined) return { meeting: known.meeting, hostEmail: known.hostEmail };

    // A conference we haven't seen: ask Meet which space it was in, as its host.
    const hosts = await this.db.read
      .select({ email: h.email, userId: h.providerUserId })
      .from(h)
      .where(inArray(h.status, ["ACTIVE", "THROTTLED"]));
    const ordered = [
      ...hosts.filter((x) => x.userId !== null && x.userId === event.hostUserId),
      ...hosts.filter((x) => x.userId === null || x.userId !== event.hostUserId),
    ];
    for (const host of ordered) {
      try {
        const conference = await this.provider?.getConference({
          hostEmail: host.email,
          conferenceId: event.conferenceId,
        });
        if (conference === undefined) return null;
        const [row] = await select().where(
          and(eq(m.provider, "google_meet"), eq(m.providerSpaceId, conference.spaceId)),
        );
        return row ?? null;
      } catch (error) {
        if (!(error instanceof ProviderNotFoundError)) throw error;
      }
    }
    return null;
  }

  private async conference(
    hostEmail: string,
    conferenceId: string,
    event: ProviderEvent,
  ): Promise<ProviderConference> {
    try {
      const { spaceId: _space, ...conference } = await (
        this.provider as LiveProvider
      ).getConference({
        hostEmail,
        conferenceId,
      });
      return conference;
    } catch (error) {
      if (!(error instanceof ProviderNotFoundError)) throw error;
      // Meet sometimes lags its own events: the event's time is the best we have.
      return { conferenceId, startedAt: event.occurredAt, endedAt: null };
    }
  }

  /** Inserts or refreshes a conference record (never deleted); marks it for a sync. */
  private async upsert(
    db: Database,
    meetingId: string,
    conference: ProviderConference,
  ): Promise<string> {
    const c = schema.conferenceRecords;
    const now = this.clock.now();
    const [row] = await db
      .insert(c)
      .values({
        classMeetingId: meetingId,
        providerConferenceId: conference.conferenceId,
        status: conference.endedAt === null ? "ACTIVE" : "ENDED",
        startedAt: conference.startedAt,
        endedAt: conference.endedAt,
        dirty: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: c.providerConferenceId,
        set: {
          status: conference.endedAt === null ? "ACTIVE" : "ENDED",
          startedAt: conference.startedAt,
          endedAt: conference.endedAt,
          dirty: true,
          updatedAt: now,
          version: sql`${c.version} + 1`,
        },
      })
      .returning({ id: c.id });
    if (row === undefined) throw new Error("conference upsert returned nothing");
    return row.id;
  }

  /** Attendance is read at the end and again 30 minutes later (§11.8). */
  private async queueSyncs(boss: TxQueue, conferenceRecordId: string): Promise<void> {
    await boss.send("conference.sync", { conferenceRecordId });
    await boss.send(
      "conference.sync",
      { conferenceRecordId },
      { startAfter: new Date(this.clock.now().getTime() + RESYNC_AFTER_MS) },
    );
  }

  /** The class ends with its last conference: none of its conferences is still active. */
  private async endIfNoneActive(meeting: MeetingRow, endedAt: Date): Promise<void> {
    const c = schema.conferenceRecords;
    const [active] = await this.db.read
      .select({ id: c.id })
      .from(c)
      .where(and(eq(c.classMeetingId, meeting.id), eq(c.status, "ACTIVE")))
      .limit(1);
    if (active === undefined)
      await this.lifecycle.applyProviderEvent(meeting.id, "CONFERENCE_ENDED", endedAt);
  }
}
