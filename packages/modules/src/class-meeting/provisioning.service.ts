import { googleMeetPolicy } from "@glim/contracts";
import { Db, schema, type Database, type TxQueue } from "@glim/db";
import {
  LIVE_PROVIDER,
  ProviderPermanentError,
  type LiveProvider,
  type SpaceSettings,
} from "@glim/integrations/live-provider/port";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { RoleService } from "@glim/modules/authorization";
import { PolicyService, SettingsService } from "@glim/modules/identity";
import { NotificationsService } from "@glim/modules/notifications";
import { IntegrationsService } from "@glim/modules/ops";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

type MeetingRow = typeof schema.classMeetings.$inferSelect;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A PROVISIONING claim older than this was left by a crashed job (§17.1 expiry is 5 min). */
const STALE_CLAIM_MS = 10 * MINUTE;
/** Lecturers hear about a failed link only when the class is this close (§11.6). */
const LECTURER_ALERT_WITHIN_MS = 2 * HOUR;
/** States in which a space is still useful. */
const OPEN_STATES = ["SCHEDULED", "OPEN", "LIVE"];

const JOB: AuditActor = { userId: null, type: "JOB" };

export type ProvisionOutcome = "READY" | "ERROR" | "SKIPPED" | "BUSY";

/** The GOOGLE_MEET policy a meeting was created under, or today's if it predates the snapshot. */
function meetPolicy(row: MeetingRow, fallback: unknown) {
  const snapshot = row.policySnapshot as { googleMeet?: { config?: unknown } } | null;
  return googleMeetPolicy.parse(snapshot?.googleMeet?.config ?? fallback ?? {});
}

/**
 * Google Meet for Class Meetings (owner: class-meeting, TRD §11.2, §11.5, §11.6): which host
 * account owns each space, creating the space in the worker (never in a request: INV-8), keeping
 * its members in step with the course, and ending the conference. Everything here is a no-op
 * while `LIVE_PROVIDER=none`.
 */
@Injectable()
export class ProvisioningService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(LIVE_PROVIDER) private readonly provider: LiveProvider | null,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(IntegrationsService) private readonly integrations: IntegrationsService,
  ) {}

  /** The provider new meetings get, or null when meetings use pasted links (v1). */
  get providerName(): "google_meet" | null {
    return this.provider === null ? null : "google_meet";
  }

  /** The GOOGLE_MEET policy to snapshot on a new meeting. */
  async snapshot(db: Database): Promise<{ version: number; config: unknown } | null> {
    if (this.provider === null) return null;
    const policy = await this.policies.current("GOOGLE_MEET", db);
    return { version: policy.version, config: policy.config };
  }

  /**
   * Queues the space for a new meeting in the caller's transaction: `provisionLeadHours` before
   * the start, or now if that's already past (§11.6 step 3).
   */
  async queueProvision(tx: { db: Database; boss: TxQueue }, meeting: MeetingRow): Promise<void> {
    if (this.provider === null || meeting.provider === null) return;
    const policy = meetPolicy(meeting, (await this.policies.current("GOOGLE_MEET", tx.db)).config);
    const at = Math.max(
      this.clock.now().getTime(),
      meeting.scheduledStart.getTime() - policy.provisionLeadHours * HOUR,
    );
    await tx.boss.send(
      "class-meeting.provision",
      { meetingId: meeting.id },
      { startAfter: new Date(at), singletonKey: `meeting:${meeting.id}:provision` },
    );
  }

  /** A provision now (join near the start, reprovision, reschedule to an earlier time). */
  async queueProvisionNow(boss: TxQueue, meetingId: string): Promise<void> {
    await boss.send("class-meeting.provision", { meetingId }, { priority: 10 });
  }

  /** Member sync, debounced to one run per 30 s per meeting (§11.5). */
  async queueSync(boss: TxQueue, meetingId: string): Promise<void> {
    if (this.provider === null) return;
    await boss.send(
      "class-meeting.sync-access",
      { meetingId },
      {
        singletonKey: `meeting:${meetingId}:sync-access`,
        singletonSeconds: 30,
        singletonNextSlot: true,
      },
    );
  }

  /**
   * Who is on a course changed (enrollment, Lecturer assignment): resyncs the members of its
   * provisioned meetings starting within `syncAccessWithinDays` (§11.5).
   */
  async queueSyncForOffering(offeringId: string): Promise<number> {
    if (this.provider === null) return 0;
    const policy = await this.policies.current("GOOGLE_MEET");
    const now = this.clock.now();
    const m = schema.classMeetings;
    const meetings = await this.db.read
      .select({ id: m.id })
      .from(m)
      .where(
        and(
          eq(m.courseOfferingId, offeringId),
          eq(m.providerStatus, "READY"),
          inArray(m.state, OPEN_STATES),
          gte(m.scheduledEnd, now),
          lte(
            m.scheduledStart,
            new Date(now.getTime() + policy.config.syncAccessWithinDays * 24 * HOUR),
          ),
        ),
      );
    if (meetings.length === 0) return 0;
    await this.db.withTx(async ({ boss }) => {
      for (const { id } of meetings) await this.queueSync(boss, id);
    });
    return meetings.length;
  }

  /**
   * The ACTIVE host account with the fewest Class Meetings overlapping [start, end), relative to
   * its weight (§11.2 HostSelector). Null when there is none.
   */
  async pickHost(
    db: Database,
    start: Date,
    end: Date,
  ): Promise<{ id: string; email: string } | null> {
    const { rows } = await db.execute<{ id: string; email: string }>(sql`
      SELECT h.id, h.email::text AS email
        FROM provider_host_accounts h
        LEFT JOIN class_meetings m
          ON m.host_account_id = h.id
         AND m.state <> 'CANCELLED'
         AND tstzrange(m.scheduled_start, m.scheduled_end) && tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz)
       WHERE h.provider = 'google_meet' AND h.status = 'ACTIVE'
       GROUP BY h.id, h.email, h.weight
       ORDER BY count(m.id)::numeric / GREATEST(h.weight, 1), h.email
       LIMIT 1`);
    return rows[0] ?? null;
  }

  /**
   * The `class-meeting.provision` job (§11.6): claims the meeting, picks its host account (kept
   * for good once chosen), creates the space, then stores it READY and queues member sync in one
   * transaction. A permanent refusal, or the last retry, marks it ERROR and tells the System
   * Admin (and the Lecturers if the class is within two hours).
   */
  async provision(meetingId: string, attempt: { final: boolean }): Promise<ProvisionOutcome> {
    const provider = this.provider;
    if (provider === null) return "SKIPPED";
    const claim = await this.db.withTx(async ({ db }) => {
      const m = schema.classMeetings;
      const [row] = await db.select().from(m).where(eq(m.id, meetingId)).for("update");
      if (row === undefined || row.provider === null || !OPEN_STATES.includes(row.state))
        return "SKIPPED" as const;
      if (row.providerStatus === "READY") return "SKIPPED" as const;
      const now = this.clock.now();
      if (
        row.providerStatus === "PROVISIONING" &&
        now.getTime() - row.updatedAt.getTime() < STALE_CLAIM_MS
      )
        return "BUSY" as const;
      const h = schema.providerHostAccounts;
      const host =
        row.hostAccountId === null
          ? await this.pickHost(db, row.scheduledStart, row.scheduledEnd)
          : ((
              await db
                .select({ id: h.id, email: h.email })
                .from(h)
                .where(eq(h.id, row.hostAccountId))
            )[0] ?? null);
      if (host === null) return { row, host: null };
      await db
        .update(m)
        .set({ providerStatus: "PROVISIONING", hostAccountId: host.id, updatedAt: now })
        .where(eq(m.id, meetingId));
      return { row, host };
    });
    if (claim === "SKIPPED" || claim === "BUSY") return claim;
    const { row, host } = claim;
    if (host === null) {
      await this.fail(
        row,
        "There is no active Google host account. Add one in the Google integration.",
      );
      return "ERROR";
    }

    const policy = meetPolicy(row, (await this.policies.current("GOOGLE_MEET")).config);
    const settings: SpaceSettings = {
      accessType: policy.accessType,
      moderation: policy.moderation,
      presentRestriction: policy.presentRestriction,
      autoRecording: row.recordingMode === "AUTO",
    };
    let space;
    try {
      space = await provider.provisionSpace({ hostEmail: host.email, settings });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ProviderPermanentError || attempt.final) {
        // A 403 is configuration (scopes, a suspended host): the integration needs attention.
        if (error instanceof ProviderPermanentError)
          await this.integrations.markDegraded("google_workspace", message, host.email);
        await this.fail(row, message);
        return "ERROR";
      }
      // Let the next attempt claim it straight away.
      await this.db.withTx(({ db }) =>
        db
          .update(schema.classMeetings)
          .set({ providerStatus: "PENDING", provisionError: message.slice(0, 500) })
          .where(eq(schema.classMeetings.id, meetingId)),
      );
      throw error;
    }

    await this.db.withTx(async ({ db, boss }) => {
      const m = schema.classMeetings;
      const now = this.clock.now();
      await db
        .update(m)
        .set({
          providerStatus: "READY",
          providerSpaceId: space.spaceId,
          providerMeetingCode: space.meetingCode,
          joinUrl: space.joinUrl,
          dialIn: space.dialIn,
          provisionedAt: now,
          provisionError: null,
          updatedAt: now,
          version: sql`${m.version} + 1`,
        })
        .where(eq(m.id, meetingId));
      await this.queueSync(boss, meetingId);
      await this.audit.record(db, JOB, {
        action: "meeting.class-meeting.provisioned",
        resourceType: "class-meeting",
        resourceId: meetingId,
        metadata: { hostAccountId: host.id, meetingCode: space.meetingCode },
      });
      await boss.publish(
        "meeting.provisioned",
        { meetingId, offeringId: row.courseOfferingId },
        { occurredAt: now, actorUserId: null },
      );
    });
    this.logger.info({ meetingId, hostAccountId: host.id }, "meeting provisioned");
    return "READY";
  }

  /** Marks a meeting's space as failed, for the ops page, and tells the people who must act. */
  private async fail(row: MeetingRow, reason: string): Promise<void> {
    await this.db.withTx(async (tx) => {
      const { db } = tx;
      const m = schema.classMeetings;
      const now = this.clock.now();
      await db
        .update(m)
        .set({ providerStatus: "ERROR", provisionError: reason.slice(0, 500), updatedAt: now })
        .where(eq(m.id, row.id));
      await this.audit.record(db, JOB, {
        action: "meeting.class-meeting.provision-failed",
        resourceType: "class-meeting",
        resourceId: row.id,
        outcome: "FAILURE",
        metadata: { reason: reason.slice(0, 500) },
      });
      const recipients = new Set(await this.roles.holders("SYSTEM_ADMIN", db));
      if (row.scheduledStart.getTime() - now.getTime() <= LECTURER_ALERT_WITHIN_MS)
        for (const userId of await this.lecturerUserIds(db, row.courseOfferingId))
          recipients.add(userId);
      const [course] = await db
        .select({ code: schema.courses.code })
        .from(schema.courseOfferings)
        .innerJoin(schema.courses, eq(schema.courses.id, schema.courseOfferings.courseId))
        .where(eq(schema.courseOfferings.id, row.courseOfferingId));
      const institution = await this.settings.get(db);
      for (const userId of recipients)
        await this.notifications.notify(tx, {
          userId,
          kind: "meeting.provision-failed",
          title: `No Google Meet link yet: ${course?.code ?? ""} ${row.title}`,
          data: {
            meetingId: row.id,
            courseCode: course?.code ?? "",
            title: row.title,
            scheduledStart: row.scheduledStart.toISOString(),
            reason: reason.slice(0, 300),
            timeZone: institution.timezone,
            institutionZone: institution.timezone,
          },
          email: true,
          dedupeKey: `meeting:${row.id}:provision-failed:${String(row.version)}`,
        });
    });
    this.logger.warn({ meetingId: row.id, reason }, "meeting provisioning failed");
  }

  /**
   * The `class-meeting.sync-access` job (§11.5): makes the space's members exactly the course's
   * Lecturers (co-hosts) and ENROLLED students with a linked Google account, so they join
   * without knocking. Students with no linked account are counted and must knock (C-39).
   */
  async syncAccess(
    meetingId: string,
  ): Promise<{ added: number; removed: number; withoutGoogle: number } | "SKIPPED"> {
    const provider = this.provider;
    if (provider === null) return "SKIPPED";
    const m = schema.classMeetings;
    const h = schema.providerHostAccounts;
    const [row] = await this.db.read
      .select({ meeting: m, hostEmail: h.email })
      .from(m)
      .innerJoin(h, eq(h.id, m.hostAccountId))
      .where(eq(m.id, meetingId));
    if (
      row === undefined ||
      row.meeting.providerStatus !== "READY" ||
      row.meeting.providerSpaceId === null ||
      !OPEN_STATES.includes(row.meeting.state)
    )
      return "SKIPPED";
    const offeringId = row.meeting.courseOfferingId;
    const cohosts = await this.lecturerEmails(offeringId);
    const { emails: members, withoutGoogle } = await this.studentEmails(offeringId);
    const result = await provider.syncAccess({
      space: { hostEmail: row.hostEmail, spaceId: row.meeting.providerSpaceId },
      cohosts,
      members,
    });
    await this.db.withTx(async ({ db }) => {
      const now = this.clock.now();
      await db.update(m).set({ accessSyncedAt: now }).where(eq(m.id, meetingId));
      await this.audit.record(db, JOB, {
        action: "meeting.class-meeting.access-synced",
        resourceType: "class-meeting",
        resourceId: meetingId,
        metadata: {
          added: result.added,
          removed: result.removed,
          cohosts: cohosts.length,
          members: members.length,
          ...(withoutGoogle.length === 0
            ? {}
            : {
                STUDENT_NO_GOOGLE_ACCOUNT: withoutGoogle.length,
                studentIds: withoutGoogle.slice(0, 50),
              }),
          ...(result.failed.length === 0 ? {} : { refused: result.failed.length }),
        },
      });
    });
    return { added: result.added, removed: result.removed, withoutGoogle: withoutGoogle.length };
  }

  /** The `class-meeting.end` job: ends the conference in Meet, if one is running. */
  async endConference(meetingId: string): Promise<"ENDED" | "SKIPPED"> {
    const provider = this.provider;
    if (provider === null) return "SKIPPED";
    const m = schema.classMeetings;
    const h = schema.providerHostAccounts;
    const [row] = await this.db.read
      .select({ spaceId: m.providerSpaceId, hostEmail: h.email })
      .from(m)
      .innerJoin(h, eq(h.id, m.hostAccountId))
      .where(eq(m.id, meetingId));
    if (row?.spaceId === null || row === undefined) return "SKIPPED";
    await provider.endActiveConference({ hostEmail: row.hostEmail, spaceId: row.spaceId });
    return "ENDED";
  }

  /**
   * `POST /class-meetings/:id/reprovision` (§11.6): asks for the space again after an ERROR (or
   * a PENDING one that seems stuck). Only for meetings still to come or live.
   */
  async reprovision(
    id: string,
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<null>> {
    if (this.provider === null)
      return err(
        domainError("CONFLICT", "Google Meet isn't switched on; paste a Meet link instead."),
      );
    return this.db.withTxResult(async ({ db, boss }) => {
      const m = schema.classMeetings;
      const [row] = await db.select().from(m).where(eq(m.id, id)).for("update");
      if (row === undefined) return err(domainError("NOT_FOUND", "Not found."));
      if (!OPEN_STATES.includes(row.state))
        return err(domainError("MEETING_STATE_INVALID", "This class is over or cancelled."));
      if (row.providerStatus === "READY")
        return err(domainError("CONFLICT", "This Class Meeting already has its Meet link."));
      const now = this.clock.now();
      await db
        .update(m)
        .set({
          provider: row.provider ?? "google_meet",
          providerStatus: "PENDING",
          provisionError: null,
          updatedAt: now,
          version: sql`${m.version} + 1`,
        })
        .where(eq(m.id, id));
      await this.queueProvisionNow(boss, id);
      await this.audit.record(db, actor, {
        action: "meeting.class-meeting.reprovision-requested",
        resourceType: "class-meeting",
        resourceId: id,
        metadata: { from: row.providerStatus },
      });
      return ok(null);
    });
  }

  // ---- helpers ----

  private async lecturerUserIds(db: Database, offeringId: string): Promise<string[]> {
    const a = schema.lecturerAssignments;
    const l = schema.lecturers;
    const rows = await db
      .selectDistinct({ userId: l.userId })
      .from(a)
      .innerJoin(l, eq(l.id, a.lecturerId))
      .where(and(eq(a.courseOfferingId, offeringId), eq(a.status, "ACTIVE")));
    return rows.map((r) => r.userId);
  }

  /** Lecturers join as their Workspace account: the account email, plus any linked Google one. */
  private async lecturerEmails(offeringId: string): Promise<string[]> {
    const a = schema.lecturerAssignments;
    const l = schema.lecturers;
    const u = schema.users;
    const i = schema.identities;
    const rows = await this.db.read
      .selectDistinct({ email: u.email, googleEmail: i.email })
      .from(a)
      .innerJoin(l, eq(l.id, a.lecturerId))
      .innerJoin(u, eq(u.id, l.userId))
      .leftJoin(i, and(eq(i.userId, u.id), eq(i.provider, "google")))
      .where(
        and(eq(a.courseOfferingId, offeringId), eq(a.status, "ACTIVE"), eq(l.status, "ACTIVE")),
      )
      .orderBy(asc(u.email));
    return [
      ...new Set(rows.flatMap((r) => [r.googleEmail ?? r.email].map((e) => e.toLowerCase()))),
    ];
  }

  /** ENROLLED students' linked Google emails (all of them, C-39), and who has none. */
  private async studentEmails(
    offeringId: string,
  ): Promise<{ emails: string[]; withoutGoogle: string[] }> {
    const ce = schema.courseEnrollments;
    const s = schema.students;
    const i = schema.identities;
    const rows = await this.db.read
      .selectDistinct({ studentId: s.id, email: i.email })
      .from(ce)
      .innerJoin(s, eq(s.id, ce.studentId))
      .leftJoin(i, and(eq(i.userId, s.userId), eq(i.provider, "google")))
      .where(
        and(eq(ce.courseOfferingId, offeringId), eq(ce.status, "ENROLLED"), eq(s.status, "ACTIVE")),
      );
    const emails = new Set<string>();
    const withGoogle = new Set<string>();
    for (const r of rows)
      if (r.email !== null) {
        emails.add(r.email.toLowerCase());
        withGoogle.add(r.studentId);
      }
    return {
      emails: [...emails].sort(),
      withoutGoogle: [...new Set(rows.map((r) => r.studentId))].filter((id) => !withGoogle.has(id)),
    };
  }
}
