import { attendancePolicy, googleMeetPolicy, type Participant } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import {
  LIVE_PROVIDER,
  type LiveProvider,
  type ProviderParticipantSession,
} from "@glim/integrations/live-provider/port";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { MeetEventsService } from "@glim/modules/class-meeting";
import { PolicyService } from "@glim/modules/identity";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  matchSession,
  meetUserId,
  normaliseName,
  type MatchDirectory,
  type MatchMethod,
  type MatchStatus,
} from "./domain/matching";

const DAY = 86_400_000;

type SessionRow = typeof schema.providerParticipantSessions.$inferSelect;
type MeetingRow = typeof schema.classMeetings.$inferSelect;

interface Person {
  userId: string;
  name: string;
  role: "STUDENT" | "LECTURER";
  matricNumber: string | null;
}

/**
 * Online evidence from Meet (owner: attendance, TRD §12.1, §12.4): `conference.sync` keeps the
 * raw participant sessions (upserted, never deleted, INV-7) and matches each to a person; staff
 * resolve the rest by hand. Attendance itself is computed from the confirmed matches.
 */
@Injectable()
export class ParticipantsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(LIVE_PROVIDER) private readonly provider: LiveProvider | null,
    @Inject(MeetEventsService) private readonly meetEvents: MeetEventsService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * The `conference.sync` job (§11.8): reads the conference's participant sessions from Meet,
   * upserts them, runs the matching ladder, marks the conference synced and queues a recompute.
   * Stops once the meeting's attendance is locked.
   */
  async syncConference(
    conferenceRecordId: string,
  ): Promise<{ sessions: number; confirmed: number } | "SKIPPED"> {
    const provider = this.provider;
    if (provider === null) return "SKIPPED";
    const found = await this.meetEvents.conferenceForSync(conferenceRecordId);
    if (found === null || this.locked(found.meeting)) return "SKIPPED";
    const { record, meeting, hostEmail } = found;
    const reported: ProviderParticipantSession[] = [];
    for await (const session of provider.listParticipantSessions({
      hostEmail,
      conferenceId: record.providerConferenceId,
    }))
      reported.push(session);

    const switches = await this.switches(meeting);
    return this.db.withTx(async ({ db, boss }) => {
      const p = schema.providerParticipantSessions;
      const now = this.clock.now();
      for (const s of reported)
        await db
          .insert(p)
          .values({
            classMeetingId: meeting.id,
            conferenceRecordId: record.id,
            providerParticipantId: s.participantId,
            providerSessionId: s.sessionId,
            participantKind: s.kind,
            providerUserId: s.providerUserId,
            displayName: s.displayName,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            raw: { ...s.raw, ...(s.email === null ? {} : { email: s.email }) },
            firstSeenAt: now,
            lastSeenAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: p.providerSessionId,
            // Evidence only grows: the match columns are left to matching and people.
            set: {
              displayName: s.displayName,
              providerUserId: s.providerUserId,
              startedAt: s.startedAt,
              endedAt: s.endedAt,
              raw: { ...s.raw, ...(s.email === null ? {} : { email: s.email }) },
              lastSeenAt: now,
              updatedAt: now,
            },
          });
      const confirmed = await this.rematch(db, meeting, switches);
      await this.meetEvents.markSynced(db, record.id);
      await boss.send("attendance.recompute", { meetingId: meeting.id });
      return { sessions: reported.length, confirmed };
    });
  }

  /** The meeting's participants, grouped, with who they matched (§12.7). */
  async list(meetingId: string): Promise<{ items: Participant[]; candidates: Person[] } | null> {
    const m = schema.classMeetings;
    const [meeting] = await this.db.read.select().from(m).where(eq(m.id, meetingId));
    if (meeting === undefined) return null;
    const people = await this.people(this.db.read, meeting.courseOfferingId);
    const p = schema.providerParticipantSessions;
    const rows = await this.db.read
      .select()
      .from(p)
      .where(eq(p.classMeetingId, meetingId))
      .orderBy(asc(p.startedAt), asc(p.providerSessionId));
    return { items: group(rows, people, this.clock.now()), candidates: [...people.values()] };
  }

  /**
   * Resolves a participant by hand (§12.4 MANUAL): every session of theirs in the meeting gets
   * the person (or none: "not on this course"), audited, with a recompute. `remember` keeps the
   * Meet id so later meetings match it automatically. Not after the attendance lock.
   */
  async match(
    meetingId: string,
    participantId: string,
    input: { userId: string | null; remember: boolean },
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<Participant>> {
    const m = schema.classMeetings;
    const [meeting] = await this.db.read.select().from(m).where(eq(m.id, meetingId));
    if (meeting === undefined) return err(domainError("NOT_FOUND", "Not found."));
    if (this.locked(meeting))
      return err(
        domainError(
          "MEETING_STATE_INVALID",
          "Attendance for this class is locked; change a student's attendance with an override.",
        ),
      );
    const people = await this.people(this.db.read, meeting.courseOfferingId);
    if (input.userId !== null && !people.has(input.userId))
      return err(
        domainError("VALIDATION_FAILED", "Choose a student or Lecturer of this course.", {
          fieldErrors: [{ path: "body.userId", code: "invalid", message: "Not on this course." }],
        }),
      );
    const p = schema.providerParticipantSessions;
    const result = await this.db.withTxResult(async ({ db, boss }) => {
      const sessions = await db
        .select()
        .from(p)
        .where(and(eq(p.classMeetingId, meetingId), eq(p.providerParticipantId, participantId)))
        .for("update");
      const first = sessions[0];
      if (first === undefined) return err(domainError("NOT_FOUND", "Not found."));
      const now = this.clock.now();
      await db
        .update(p)
        .set({
          matchedUserId: input.userId,
          matchMethod: "MANUAL",
          matchStatus: "CONFIRMED",
          updatedAt: now,
          version: sql`${p.version} + 1`,
        })
        .where(and(eq(p.classMeetingId, meetingId), eq(p.providerParticipantId, participantId)));
      const remembered =
        input.remember &&
        input.userId !== null &&
        first.participantKind === "SIGNED_IN" &&
        first.providerUserId !== null;
      if (remembered) {
        const a = schema.participantAliases;
        await db
          .insert(a)
          .values({
            providerUserId: meetUserId(first.providerUserId ?? ""),
            userId: input.userId ?? "",
            createdBy: actor.userId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [a.provider, a.providerUserId],
            set: { userId: input.userId ?? "", createdBy: actor.userId, updatedAt: now },
          });
      }
      await this.audit.record(db, actor, {
        action: "attendance.participant.matched",
        resourceType: "class-meeting",
        resourceId: meetingId,
        metadata: {
          participantId,
          from: {
            userId: first.matchedUserId,
            method: first.matchMethod,
            status: first.matchStatus,
          },
          to: { userId: input.userId },
          remembered,
        },
      });
      await boss.send("attendance.recompute", { meetingId });
      return ok(null);
    });
    if (!result.ok) return result;
    const view = await this.list(meetingId);
    const item = view?.items.find((x) => x.participantId === participantId);
    return item === undefined ? err(domainError("NOT_FOUND", "Not found.")) : ok(item);
  }

  /**
   * The online evidence for `computeAttendance`: the meeting's conferences, and each enrolled
   * student's confirmed sessions; plus every participant, resolved or not, for the review rule.
   * People matched who aren't students of the course (the Lecturer's room laptop) are kept as
   * evidence but count for nobody (§12.4).
   */
  async evidence(
    db: Database,
    meetingId: string,
    studentUserIds: ReadonlyMap<string, string>,
  ): Promise<{
    conferences: { start: Date; end: Date | null }[];
    online: Record<string, { start: Date; end: Date | null }[]>;
    participants: {
      participantId: string;
      resolved: boolean;
      intervals: { start: Date; end: Date | null }[];
    }[];
  }> {
    const c = schema.conferenceRecords;
    const conferences = (
      await db
        .select({ start: c.startedAt, end: c.endedAt })
        .from(c)
        .where(eq(c.classMeetingId, meetingId))
    ).map((x) => ({ start: x.start, end: x.end }));
    const p = schema.providerParticipantSessions;
    const sessions = await db.select().from(p).where(eq(p.classMeetingId, meetingId));
    const online: Record<string, { start: Date; end: Date | null }[]> = {};
    const byParticipant = new Map<
      string,
      { resolved: boolean; intervals: { start: Date; end: Date | null }[] }
    >();
    for (const s of sessions) {
      const interval = { start: s.startedAt, end: s.endedAt };
      const confirmed = s.matchStatus === "CONFIRMED";
      const studentId = s.matchedUserId === null ? undefined : studentUserIds.get(s.matchedUserId);
      if (confirmed && studentId !== undefined) (online[studentId] ??= []).push(interval);
      const entry = byParticipant.get(s.providerParticipantId) ?? { resolved: true, intervals: [] };
      entry.resolved &&= confirmed;
      entry.intervals.push(interval);
      byParticipant.set(s.providerParticipantId, entry);
    }
    return {
      conferences,
      online,
      participants: [...byParticipant].map(([participantId, e]) => ({ participantId, ...e })),
    };
  }

  // ---- helpers ----

  private locked(meeting: MeetingRow): boolean {
    if (meeting.finalizedAt === null) return false;
    const policy = attendancePolicy.parse(
      (meeting.policySnapshot as { attendance?: { config?: unknown } }).attendance?.config ?? {},
    );
    return this.clock.now().getTime() > meeting.finalizedAt.getTime() + policy.lockAfterDays * DAY;
  }

  private async switches(meeting: MeetingRow) {
    const snapshot = (meeting.policySnapshot as { googleMeet?: { config?: unknown } }).googleMeet;
    return googleMeetPolicy.parse(
      snapshot?.config ?? (await this.policies.current("GOOGLE_MEET")).config,
    ).matching;
  }

  /** Runs the ladder over the meeting's sessions; returns how many are confirmed. */
  private async rematch(
    db: Database,
    meeting: MeetingRow,
    switches: { googleId: boolean; memberEmail: boolean; nameAssisted: boolean },
  ): Promise<number> {
    const p = schema.providerParticipantSessions;
    const sessions = await db.select().from(p).where(eq(p.classMeetingId, meeting.id));
    const directory = await this.directory(db, meeting, sessions);
    const now = this.clock.now();
    let confirmed = 0;
    for (const s of sessions) {
      const result = matchSession(
        {
          kind: s.participantKind as "SIGNED_IN" | "ANONYMOUS" | "PHONE",
          providerUserId: s.providerUserId,
          email: typeof s.raw.email === "string" ? s.raw.email : null,
          displayName: s.displayName,
          current: {
            userId: s.matchedUserId,
            method: s.matchMethod as MatchMethod,
            status: s.matchStatus as MatchStatus,
          },
        },
        directory,
        switches,
      );
      if (result.status === "CONFIRMED") confirmed++;
      if (
        result.userId !== s.matchedUserId ||
        result.method !== s.matchMethod ||
        result.status !== s.matchStatus
      )
        await db
          .update(p)
          .set({
            matchedUserId: result.userId,
            matchMethod: result.method,
            matchStatus: result.status,
            updatedAt: now,
          })
          .where(eq(p.id, s.id));
    }
    return confirmed;
  }

  /** The lookups the ladder needs, limited to what these sessions can match. */
  private async directory(
    db: Database,
    meeting: MeetingRow,
    sessions: SessionRow[],
  ): Promise<MatchDirectory> {
    const i = schema.identities;
    const ids = [
      ...new Set(
        sessions.flatMap((s) => (s.providerUserId === null ? [] : [meetUserId(s.providerUserId)])),
      ),
    ];
    const emails = [
      ...new Set(
        sessions.flatMap((s) =>
          typeof s.raw.email === "string" ? [s.raw.email.toLowerCase()] : [],
        ),
      ),
    ];
    const bySubject = new Map<string, string>();
    const byEmail = new Map<string, string>();
    const byRememberedId = new Map<string, string>();
    if (ids.length > 0) {
      for (const r of await db
        .select({ subject: i.subject, userId: i.userId })
        .from(i)
        .where(and(eq(i.provider, "google"), inArray(i.subject, ids))))
        bySubject.set(r.subject, r.userId);
      const a = schema.participantAliases;
      for (const r of await db
        .select({ id: a.providerUserId, userId: a.userId })
        .from(a)
        .where(and(eq(a.provider, "google_meet"), inArray(a.providerUserId, ids))))
        byRememberedId.set(r.id, r.userId);
    }
    if (emails.length > 0)
      for (const r of await db
        .select({ email: i.email, userId: i.userId })
        .from(i)
        .where(and(eq(i.provider, "google"), inArray(sql`lower(${i.email})`, emails))))
        if (r.email !== null) byEmail.set(r.email.toLowerCase(), r.userId);

    // Name suggestions only among the course's students, by the name Google gave at link time.
    const ce = schema.courseEnrollments;
    const s = schema.students;
    const names = await db
      .selectDistinct({ userId: s.userId, metadata: i.metadata })
      .from(ce)
      .innerJoin(s, eq(s.id, ce.studentId))
      .innerJoin(i, and(eq(i.userId, s.userId), eq(i.provider, "google")))
      .where(eq(ce.courseOfferingId, meeting.courseOfferingId));
    const byName = new Map<string, string[]>();
    for (const n of names) {
      const googleName = (n.metadata as { googleName?: unknown }).googleName;
      if (typeof googleName !== "string" || googleName.trim() === "") continue;
      const key = normaliseName(googleName);
      const users = byName.get(key) ?? [];
      if (!users.includes(n.userId)) users.push(n.userId);
      byName.set(key, users);
    }
    return { bySubject, byRememberedId, byEmail, byName };
  }

  /** The course's students (any enrollment) and Lecturers, by user. */
  private async people(db: Database, offeringId: string): Promise<Map<string, Person>> {
    const ce = schema.courseEnrollments;
    const s = schema.students;
    const pe = schema.programmeEnrollments;
    const students = await db
      .selectDistinctOn([s.userId], {
        userId: s.userId,
        givenName: s.givenName,
        familyName: s.familyName,
        matricNumber: pe.matricNumber,
      })
      .from(ce)
      .innerJoin(s, eq(s.id, ce.studentId))
      .innerJoin(pe, eq(pe.id, ce.programmeEnrollmentId))
      .where(eq(ce.courseOfferingId, offeringId));
    const a = schema.lecturerAssignments;
    const l = schema.lecturers;
    const lecturers = await db
      .selectDistinct({ userId: l.userId, name: schema.users.displayName })
      .from(a)
      .innerJoin(l, eq(l.id, a.lecturerId))
      .innerJoin(schema.users, eq(schema.users.id, l.userId))
      .where(eq(a.courseOfferingId, offeringId));
    const people = new Map<string, Person>();
    for (const x of lecturers)
      people.set(x.userId, {
        userId: x.userId,
        name: x.name,
        role: "LECTURER",
        matricNumber: null,
      });
    for (const x of students)
      people.set(x.userId, {
        userId: x.userId,
        name: `${x.givenName} ${x.familyName}`,
        role: "STUDENT",
        matricNumber: x.matricNumber,
      });
    return people;
  }
}

/** Sessions grouped per participant, earliest first. */
function group(rows: SessionRow[], people: Map<string, Person>, now: Date): Participant[] {
  const out = new Map<string, Participant>();
  for (const r of rows) {
    let item = out.get(r.providerParticipantId);
    if (item === undefined) {
      const person = r.matchedUserId === null ? undefined : people.get(r.matchedUserId);
      item = {
        participantId: r.providerParticipantId,
        kind: r.participantKind as Participant["kind"],
        displayName: r.displayName,
        sessions: [],
        seconds: 0,
        match: {
          userId: r.matchedUserId,
          name: person?.name ?? null,
          role: person?.role ?? null,
          method: r.matchMethod as Participant["match"]["method"],
          status: r.matchStatus as Participant["match"]["status"],
        },
      };
      out.set(r.providerParticipantId, item);
    }
    item.sessions.push({
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
    });
    item.seconds += Math.max(
      0,
      Math.floor(((r.endedAt ?? now).getTime() - r.startedAt.getTime()) / 1000),
    );
  }
  return [...out.values()];
}
