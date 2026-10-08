import { attendancePolicy, type RollCall, type RollCallMark } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { FilesService } from "@glim/modules/content";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

type MeetingRow = typeof schema.classMeetings.$inferSelect;

const DAY = 86_400_000;
const MINUTE = 60_000;

/** The ATTENDANCE policy a meeting was created under (snapshot, §12.2). */
function policyOf(meeting: MeetingRow) {
  const snapshot = meeting.policySnapshot as { attendance?: { config?: unknown } } | null;
  return attendancePolicy.parse(snapshot?.attendance?.config ?? {});
}

/**
 * Roll call (owner: attendance, TRD §12.3; v1 spec adds `mode`, so online students can be marked
 * by hand too). Open from `rollCallOpensBeforeMinutes` before the start until `lockAfterDays`
 * after finalization. Each batch is audited, bumps the roll call's version (`If-Match`) and
 * queues `attendance.recompute`.
 */
@Injectable()
export class RollCallService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  async get(meetingId: string): Promise<RollCall | null> {
    const meeting = await this.meeting(meetingId);
    if (meeting === null) return null;
    const window = this.window(meeting);
    const [version] = await this.db.read
      .select({ version: schema.rollCalls.version })
      .from(schema.rollCalls)
      .where(eq(schema.rollCalls.classMeetingId, meetingId));
    const people = await this.students(this.db.read, meeting);
    const marks = await this.db.read
      .select()
      .from(schema.rollCallMarks)
      .where(eq(schema.rollCallMarks.classMeetingId, meetingId));
    const byStudent = new Map(marks.map((m) => [m.studentId, m]));
    const photos = await this.files.presignedReadUrls(
      people.flatMap((s) => (s.photoFileId === null ? [] : [s.photoFileId])),
    );
    return {
      meetingId,
      version: version?.version ?? 0,
      open: window.open,
      opensAt: window.opensAt.toISOString(),
      closesAt: window.closesAt?.toISOString() ?? null,
      students: people.map((s) => {
        const mark = byStudent.get(s.studentId);
        return {
          studentId: s.studentId,
          name: s.name,
          matricNumber: s.matricNumber,
          studyMode: s.studyMode as RollCall["students"][number]["studyMode"],
          photoUrl: s.photoFileId === null ? null : (photos.get(s.photoFileId) ?? null),
          mark:
            mark === undefined
              ? null
              : {
                  present: mark.present,
                  late: mark.late,
                  mode: mark.mode as RollCallMark["mode"],
                },
        };
      }),
    };
  }

  /** Saves a batch of marks (an upsert per student), if the roll call is open and unchanged. */
  async put(
    meetingId: string,
    expectedVersion: number,
    marks: RollCallMark[],
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<RollCall>> {
    const result = await this.db.withTxResult(async ({ db, boss }) => {
      const m = schema.classMeetings;
      const [meeting] = await db.select().from(m).where(eq(m.id, meetingId)).for("share");
      if (meeting === undefined) return err(domainError("NOT_FOUND", "Not found."));
      if (meeting.state === "CANCELLED" || meeting.state === "NO_SHOW")
        return err(
          domainError(
            "MEETING_STATE_INVALID",
            "This class didn't take place, so it has no roll call.",
          ),
        );
      const window = this.window(meeting);
      if (!window.open)
        return err(
          domainError(
            "ROLL_CALL_CLOSED",
            this.clock.now() < window.opensAt
              ? "Roll call opens shortly before the class starts."
              : "Roll call for this class is locked.",
          ),
        );
      const allowed = new Set((await this.students(db, meeting)).map((s) => s.studentId));
      const stranger = marks.find((mark) => !allowed.has(mark.studentId));
      if (stranger !== undefined)
        return err(
          domainError("VALIDATION_FAILED", "Mark only the students enrolled on this course.", {
            fieldErrors: [
              {
                path: "body.marks",
                code: "invalid",
                message: `Not enrolled: ${stranger.studentId}`,
              },
            ],
          }),
        );
      if (marks.some((mark) => mark.late && !mark.present))
        return err(domainError("VALIDATION_FAILED", "Only a present student can be late."));

      const rc = schema.rollCalls;
      await db.insert(rc).values({ classMeetingId: meetingId }).onConflictDoNothing();
      const [sheet] = await db
        .select()
        .from(rc)
        .where(eq(rc.classMeetingId, meetingId))
        .for("update");
      if (sheet?.version !== expectedVersion)
        return err(
          domainError(
            "VERSION_MISMATCH",
            "Someone else saved this roll call. It has been reloaded; your marks will be sent again.",
          ),
        );

      const now = this.clock.now();
      const r = schema.rollCallMarks;
      const existing = new Map(
        (await db.select().from(r).where(eq(r.classMeetingId, meetingId))).map((x) => [
          x.studentId,
          x,
        ]),
      );
      const changed = marks.filter((mark) => {
        const before = existing.get(mark.studentId);
        return (
          before === undefined ||
          before.present !== mark.present ||
          before.late !== mark.late ||
          before.mode !== mark.mode
        );
      });
      for (const mark of changed)
        await db
          .insert(r)
          .values({
            classMeetingId: meetingId,
            studentId: mark.studentId,
            present: mark.present,
            late: mark.late,
            mode: mark.mode,
            markedBy: actor.userId,
            markedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [r.classMeetingId, r.studentId],
            set: {
              present: mark.present,
              late: mark.late,
              mode: mark.mode,
              markedBy: actor.userId,
              markedAt: now,
              updatedAt: now,
              version: sql`${r.version} + 1`,
            },
          });
      if (changed.length > 0) {
        await db
          .update(rc)
          .set({ version: sql`${rc.version} + 1`, updatedAt: now, updatedBy: actor.userId })
          .where(eq(rc.classMeetingId, meetingId));
        await this.audit.record(db, actor, {
          action: "attendance.roll-call.updated",
          resourceType: "class-meeting",
          resourceId: meetingId,
          metadata: {
            changed: changed.map((mark) => ({
              studentId: mark.studentId,
              present: mark.present,
              late: mark.late,
              mode: mark.mode,
              ...(existing.has(mark.studentId)
                ? {
                    was: {
                      present: existing.get(mark.studentId)?.present,
                      late: existing.get(mark.studentId)?.late,
                      mode: existing.get(mark.studentId)?.mode,
                    },
                  }
                : {}),
            })),
          },
        });
        await boss.publish(
          "attendance.roll-call.updated",
          { meetingId, offeringId: meeting.courseOfferingId },
          { occurredAt: now, actorUserId: actor.userId },
        );
        await boss.send("attendance.recompute", { meetingId });
      }
      return ok(null);
    });
    if (!result.ok) return result;
    const view = await this.get(meetingId);
    return view === null ? err(domainError("NOT_FOUND", "Not found.")) : ok(view);
  }

  /** Whether any roll-call mark exists (a class with roll call took place, §11.4). */
  async hasMarks(db: Database, meetingId: string): Promise<boolean> {
    const r = schema.rollCallMarks;
    const [row] = await db
      .select({ id: r.id })
      .from(r)
      .where(eq(r.classMeetingId, meetingId))
      .limit(1);
    return row !== undefined;
  }

  private async meeting(id: string): Promise<MeetingRow | null> {
    const m = schema.classMeetings;
    const [row] = await this.db.read.select().from(m).where(eq(m.id, id));
    return row ?? null;
  }

  private window(meeting: MeetingRow): { open: boolean; opensAt: Date; closesAt: Date | null } {
    const policy = policyOf(meeting);
    const opensAt = new Date(
      meeting.scheduledStart.getTime() - policy.rollCallOpensBeforeMinutes * MINUTE,
    );
    const closesAt =
      meeting.finalizedAt === null
        ? null
        : new Date(meeting.finalizedAt.getTime() + policy.lockAfterDays * DAY);
    const now = this.clock.now();
    const stateOk = meeting.state !== "CANCELLED" && meeting.state !== "NO_SHOW";
    return {
      open: stateOk && now >= opensAt && (closesAt === null || now <= closesAt),
      opensAt,
      closesAt,
    };
  }

  /**
   * The offering's ENROLLED students (and anyone already marked), On-campus first, then by name
   * (§12.3).
   */
  private async students(db: Database, meeting: MeetingRow) {
    const ce = schema.courseEnrollments;
    const s = schema.students;
    const pe = schema.programmeEnrollments;
    const marked = db
      .select({ id: schema.rollCallMarks.studentId })
      .from(schema.rollCallMarks)
      .where(eq(schema.rollCallMarks.classMeetingId, meeting.id));
    const rows = await db
      .selectDistinctOn([s.id], {
        studentId: s.id,
        givenName: s.givenName,
        familyName: s.familyName,
        photoFileId: s.photoFileId,
        matricNumber: pe.matricNumber,
        studyMode: pe.studyMode,
      })
      .from(ce)
      .innerJoin(s, eq(s.id, ce.studentId))
      .innerJoin(pe, eq(pe.id, ce.programmeEnrollmentId))
      .where(
        and(
          eq(ce.courseOfferingId, meeting.courseOfferingId),
          or(eq(ce.status, "ENROLLED"), inArray(ce.studentId, marked)),
        ),
      )
      .orderBy(s.id, asc(pe.matricNumber));
    return rows
      .map((row) => ({ ...row, name: `${row.givenName} ${row.familyName}` }))
      .sort(
        (a, b) =>
          Number(b.studyMode === "ON_CAMPUS") - Number(a.studyMode === "ON_CAMPUS") ||
          a.familyName.localeCompare(b.familyName) ||
          a.givenName.localeCompare(b.givenName),
      );
  }
}
