import type {
  Transcript,
  TranscriptRequest,
  TranscriptSnapshot,
  Verification,
} from "@glim/contracts";
import { Db, schema, type Database, type Tx } from "@glim/db";
import { MAILER, type Mailer } from "@glim/integrations/mail/port";
import { TRANSCRIPT_RENDERER, type TranscriptRenderer } from "@glim/integrations/pdf/port";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { FilesService } from "@glim/modules/content";
import { NotificationsService } from "@glim/modules/notifications";
import {
  CLOCK,
  domainError,
  err,
  ok,
  type Clock,
  type DomainError,
  type DomainResult,
} from "@glim/shared";
import { CONFIG, type Config } from "@glim/shared/config";
import { toLocalDate, zonedToInstant } from "@glim/shared/time";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNull, sql, type SQL } from "drizzle-orm";
import { snapshotSha256, verificationCode } from "./domain/canonical";
import { buildSnapshot } from "./snapshot";

type Actor = AuditActor & { userId: string };
type RequestRow = typeof schema.transcriptRequests.$inferSelect;

export type RequestInput =
  | { kind: "UNOFFICIAL" }
  | { kind: "OFFICIAL"; purpose: string; recipientName: string; recipientEmail: string };

/** The largest PDF sent as an attachment (§14.7). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const JOB_ACTOR: AuditActor = { userId: null, type: "JOB" };

/** Unofficial transcripts a student may have issued in a day (§14.7). */
export const UNOFFICIAL_PER_DAY = 5;

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const conflict = (message: string) => err(domainError("CONFLICT", message));

/**
 * Transcripts (owner: transcripts, TRD §14.7). A student asks for one; an unofficial transcript is
 * issued at once, an official one after the Registrar approves it. Issuing freezes a snapshot of
 * the record, anchors it with its SHA-256 and gives it a serial number and a verification code
 * anyone can check.
 */
@Injectable()
export class TranscriptsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(TRANSCRIPT_RENDERER) private readonly renderer: TranscriptRenderer,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async request(
    programmeEnrollmentId: string,
    input: RequestInput,
    actor: Actor,
  ): Promise<DomainResult<TranscriptRequest>> {
    const result = await this.db.withTxResult<string, DomainError>(async (tx) => {
      const { db } = tx;
      const pe = schema.programmeEnrollments;
      const [enrollment] = await db
        .select({ studentId: pe.studentId, userId: schema.students.userId })
        .from(pe)
        .innerJoin(schema.students, eq(schema.students.id, pe.studentId))
        .where(eq(pe.id, programmeEnrollmentId));
      if (enrollment === undefined || enrollment.userId !== actor.userId) return notFound();
      const now = this.clock.now();
      const tr = schema.transcriptRequests;
      if (input.kind === "UNOFFICIAL") {
        // Serialize a student's requests so two at once can't both slip under the daily limit.
        await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${enrollment.studentId}))`);
        const zone = await this.timezone(db);
        const today = toLocalDate(now, zone);
        const since = new Date(zonedToInstant(today, "00:00", zone));
        const [counted] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(tr)
          .where(
            and(
              eq(tr.studentId, enrollment.studentId),
              eq(tr.kind, "UNOFFICIAL"),
              gte(tr.createdAt, since),
            ),
          );
        if ((counted?.n ?? 0) >= UNOFFICIAL_PER_DAY)
          return err(
            domainError(
              "RATE_LIMITED",
              `You can have ${String(UNOFFICIAL_PER_DAY)} unofficial transcripts a day. Try again tomorrow.`,
            ),
          );
      }
      const [row] = await db
        .insert(tr)
        .values({
          studentId: enrollment.studentId,
          programmeEnrollmentId,
          kind: input.kind,
          purpose: input.kind === "OFFICIAL" ? input.purpose : null,
          recipientName: input.kind === "OFFICIAL" ? input.recipientName : null,
          recipientEmail: input.kind === "OFFICIAL" ? input.recipientEmail : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (row === undefined) throw new Error("transcript request insert returned nothing");
      await this.audit.record(db, actor, {
        action: "transcript.requested",
        resourceType: "transcript_request",
        resourceId: row.id,
        metadata: { kind: input.kind, programmeEnrollmentId },
      });
      // Unofficial transcripts are issued straight away (C-39), in the same transaction.
      if (input.kind === "UNOFFICIAL") {
        const issued = await this.issueInTx(tx, row, actor);
        if (!issued.ok) return issued;
      }
      return ok(row.id);
    });
    return result.ok ? ok(await this.requestView(result.value)) : result;
  }

  async approve(requestId: string, actor: Actor): Promise<DomainResult<TranscriptRequest>> {
    return this.decide(requestId, actor, "APPROVED", null);
  }

  async reject(
    requestId: string,
    reason: string,
    actor: Actor,
  ): Promise<DomainResult<TranscriptRequest>> {
    return this.decide(requestId, actor, "REJECTED", reason);
  }

  /** Issues an approved (or unofficial) request; issuing again returns it as it is. */
  async issue(requestId: string, actor: Actor): Promise<DomainResult<TranscriptRequest>> {
    const result = await this.db.withTxResult<null, DomainError>(async (tx) => {
      const tr = schema.transcriptRequests;
      const [row] = await tx.db.select().from(tr).where(eq(tr.id, requestId)).for("update");
      if (row === undefined) return notFound();
      if (row.status === "ISSUED") return ok(null);
      if (row.kind === "OFFICIAL" && row.status !== "APPROVED")
        return conflict("Approve the request before issuing it.");
      if (row.status !== "APPROVED" && row.status !== "REQUESTED")
        return conflict("This request was rejected or cancelled.");
      const issued = await this.issueInTx(tx, row, actor);
      return issued.ok ? ok(null) : issued;
    });
    return result.ok ? ok(await this.requestView(requestId)) : result;
  }

  async listRequests(status?: TranscriptRequest["status"]): Promise<TranscriptRequest[]> {
    return this.requestViews(
      status === undefined ? undefined : eq(schema.transcriptRequests.status, status),
    );
  }

  async mine(userId: string): Promise<TranscriptRequest[]> {
    return this.requestViews(eq(schema.students.userId, userId));
  }

  async get(id: string): Promise<Transcript | null> {
    const t = schema.transcripts;
    const [row] = await this.db.read.select().from(t).where(eq(t.id, id));
    if (row === undefined) return null;
    return {
      id: row.id,
      kind: row.kind as Transcript["kind"],
      serialNo: row.serialNo,
      status: row.status as Transcript["status"],
      issuedAt: row.issuedAt.toISOString(),
      asOf: row.asOf,
      verificationCode: row.verificationCode,
      snapshotSha256: row.snapshotSha256,
      snapshot: row.snapshot as TranscriptSnapshot,
      revokeReason: row.revokeReason,
    };
  }

  /** The public check (§14.7): only what `verify_transcript` exposes. */
  async verify(code: string): Promise<Verification | null> {
    const result = await this.db.read.execute<{
      valid: boolean;
      status: string;
      issued_at: Date | string;
      institution_name: string;
      programme_name: string;
      student_initials: string;
      as_of: string;
      snapshot_sha256: string;
    }>(sql`SELECT * FROM verify_transcript(${code})`);
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      valid: row.valid,
      status: row.status as Verification["status"],
      issuedAt: new Date(row.issued_at).toISOString(),
      institutionName: row.institution_name,
      programmeName: row.programme_name,
      studentInitials: row.student_initials,
      asOf: typeof row.as_of === "string" ? row.as_of : String(row.as_of),
      snapshotSha256: row.snapshot_sha256,
    };
  }

  /**
   * The `transcript.generate` job: renders the PDF from the snapshot only and attaches it.
   * Rendering again changes nothing once a PDF is attached.
   */
  async generate(transcriptId: string): Promise<void> {
    const t = schema.transcripts;
    const [row] = await this.db.read
      .select({ transcript: t, userId: schema.students.userId })
      .from(t)
      .innerJoin(schema.students, eq(schema.students.id, t.studentId))
      .where(eq(t.id, transcriptId));
    if (row === undefined || row.transcript.fileId !== null) return;
    const pdf = await this.renderer.render({
      snapshot: row.transcript.snapshot as TranscriptSnapshot,
      serialNo: row.transcript.serialNo,
      verificationCode: row.transcript.verificationCode,
      snapshotSha256: row.transcript.snapshotSha256,
      verifyUrl: this.verifyUrl(row.transcript.verificationCode),
    });
    const file = await this.files.store({
      ownerUserId: row.userId,
      purpose: "TRANSCRIPT_PDF",
      name: `transcript-${row.transcript.serialNo.replaceAll("/", "-")}.pdf`,
      mime: "application/pdf",
      bytes: pdf,
    });
    await this.db.withTx(({ db }) =>
      db
        .update(t)
        .set({ fileId: file.id })
        .where(and(eq(t.id, transcriptId), isNull(t.fileId))),
    );
  }

  /** A short-lived URL to the PDF, or why there isn't one yet. */
  async downloadUrl(transcriptId: string): Promise<DomainResult<string>> {
    const t = schema.transcripts;
    const [row] = await this.db.read
      .select({ fileId: t.fileId })
      .from(t)
      .where(eq(t.id, transcriptId));
    if (row === undefined) return notFound();
    if (row.fileId === null)
      return conflict("The PDF is still being prepared. Try again in a minute.");
    const url = (await this.files.presignedReadUrls([row.fileId])).get(row.fileId);
    return url === undefined ? conflict("The PDF isn't available.") : ok(url);
  }

  /**
   * Queues the PDF to be emailed to a recipient (the request's recipient by default). Only an
   * issued transcript whose PDF is ready can be sent.
   */
  async send(
    transcriptId: string,
    to: string | undefined,
    actor: Actor,
  ): Promise<DomainResult<{ to: string }>> {
    return this.db.withTxResult<{ to: string }, DomainError>(async (tx) => {
      const t = schema.transcripts;
      const [row] = await tx.db
        .select({ transcript: t, recipient: schema.transcriptRequests.recipientEmail })
        .from(t)
        .leftJoin(schema.transcriptRequests, eq(schema.transcriptRequests.id, t.requestId))
        .where(eq(t.id, transcriptId));
      if (row === undefined) return notFound();
      if (row.transcript.status !== "ISSUED")
        return conflict("Only a valid transcript can be sent.");
      if (row.transcript.fileId === null)
        return conflict("The PDF is still being prepared. Try again in a minute.");
      const recipient = to ?? row.recipient;
      if (recipient === null)
        return err(
          domainError("VALIDATION_FAILED", "Say who to send it to.", {
            fieldErrors: [{ path: "body.to", code: "required", message: "Give an email." }],
          }),
        );
      await tx.boss.send("transcript.send", { transcriptId, to: recipient });
      await this.audit.record(tx.db, actor, {
        action: "transcript.sent",
        resourceType: "transcript",
        resourceId: transcriptId,
        metadata: { to: recipient },
      });
      return ok({ to: recipient });
    });
  }

  /** The `transcript.send` job: emails the PDF as an attachment (≤ 5 MB). */
  async sendNow(transcriptId: string, to: string): Promise<void> {
    const t = schema.transcripts;
    const [row] = await this.db.read.select().from(t).where(eq(t.id, transcriptId));
    if (row?.fileId == null || row.status !== "ISSUED") return;
    const file = await this.files.read(row.fileId);
    if (file === null) throw new Error(`transcript ${transcriptId} PDF is missing`);
    if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES)
      throw new Error(`transcript ${transcriptId} PDF is too large to attach`);
    const snapshot = row.snapshot as TranscriptSnapshot;
    await this.mailer.send({
      to,
      subject: `Transcript ${row.serialNo}: ${snapshot.student.legalName}`,
      text: [
        `${snapshot.institution.name} sends the ${row.kind === "OFFICIAL" ? "official" : "unofficial"} transcript of ${snapshot.student.legalName} (${snapshot.programme.name}), serial number ${row.serialNo}.`,
        `Check that it is genuine at ${this.verifyUrl(row.verificationCode)}`,
      ].join("\n\n"),
      category: "transcript-delivery",
      attachments: [
        { filename: file.file.originalName, contentType: "application/pdf", content: file.bytes },
      ],
    });
  }

  /** Revokes an issued transcript with a reason; the verify page shows it from now on. */
  async revoke(
    transcriptId: string,
    reason: string,
    actor: Actor,
  ): Promise<DomainResult<Transcript>> {
    const result = await this.db.withTxResult<null, DomainError>(async (tx) => {
      const t = schema.transcripts;
      const [row] = await tx.db.select().from(t).where(eq(t.id, transcriptId)).for("update");
      if (row === undefined) return notFound();
      if (row.status === "REVOKED") return ok(null);
      if (row.status !== "ISSUED") return conflict("This transcript was already superseded.");
      const now = this.clock.now();
      await tx.db
        .update(t)
        .set({ status: "REVOKED", revokedBy: actor.userId, revokedAt: now, revokeReason: reason })
        .where(eq(t.id, transcriptId));
      const [student] = await tx.db
        .select({ userId: schema.students.userId })
        .from(schema.students)
        .where(eq(schema.students.id, row.studentId));
      if (student !== undefined)
        await this.notifications.notify(tx, {
          userId: student.userId,
          kind: "transcript.revoked",
          title: `Transcript ${row.serialNo} was revoked`,
          body: reason,
          data: { transcriptId, serialNo: row.serialNo, reason },
          email: true,
          dedupeKey: `transcript-revoked:${transcriptId}`,
        });
      await this.audit.record(tx.db, actor, {
        action: "transcript.revoked",
        resourceType: "transcript",
        resourceId: transcriptId,
        metadata: { serialNo: row.serialNo, reason },
      });
      return ok(null);
    });
    if (!result.ok) return result;
    const found = await this.get(transcriptId);
    return found === null ? notFound() : ok(found);
  }

  /**
   * After a course result is reopened (§14.3), marks the programme enrollment's issued
   * transcripts that list that course completed on that date SUPERSEDED. Idempotent.
   */
  async supersedeFor(input: {
    programmeEnrollmentId: string;
    courseCode: string;
    completedOn: string;
    reason: string;
  }): Promise<string[]> {
    return this.db.withTx(async ({ db }) => {
      const t = schema.transcripts;
      const path = `$.courses[*] ? (@.code == $code && @.completedOn == $completedOn)`;
      const vars = JSON.stringify({ code: input.courseCode, completedOn: input.completedOn });
      const rows = await db
        .update(t)
        .set({ status: "SUPERSEDED" })
        .where(
          and(
            eq(t.programmeEnrollmentId, input.programmeEnrollmentId),
            eq(t.status, "ISSUED"),
            sql`jsonb_path_exists(${t.snapshot}, ${path}::jsonpath, ${vars}::jsonb)`,
          ),
        )
        .returning({ id: t.id, serialNo: t.serialNo });
      for (const row of rows)
        await this.audit.record(db, JOB_ACTOR, {
          action: "transcript.superseded",
          resourceType: "transcript",
          resourceId: row.id,
          metadata: { serialNo: row.serialNo, reason: input.reason },
        });
      return rows.map((r) => r.id);
    });
  }

  private verifyUrl(code: string): string {
    return `${this.config.appOrigin}/verify/${code}`;
  }

  /** For authorization: whose transcript it is. */
  async ownerOfTranscript(id: string): Promise<{ ownerUserId: string } | null> {
    const t = schema.transcripts;
    const [row] = await this.db.read
      .select({ ownerUserId: schema.students.userId })
      .from(t)
      .innerJoin(schema.students, eq(schema.students.id, t.studentId))
      .where(eq(t.id, id));
    return row ?? null;
  }

  /** For authorization: whose programme enrollment it is. */
  async ownerOfEnrollment(id: string): Promise<{ ownerUserId: string } | null> {
    const pe = schema.programmeEnrollments;
    const [row] = await this.db.read
      .select({ ownerUserId: schema.students.userId })
      .from(pe)
      .innerJoin(schema.students, eq(schema.students.id, pe.studentId))
      .where(eq(pe.id, id));
    return row ?? null;
  }

  // ---- helpers ----

  /**
   * Issues inside the caller's transaction: the snapshot as of today, its SHA-256, the next serial
   * for the year, a verification code, the transcript row, the request ISSUED, the student told
   * (by email: it's a critical kind) and the audit entry.
   */
  private async issueInTx(tx: Tx, request: RequestRow, actor: Actor): Promise<DomainResult<null>> {
    const { db } = tx;
    const now = this.clock.now();
    const asOf = toLocalDate(now, await this.timezone(db));
    const built = await buildSnapshot(
      db,
      request.programmeEnrollmentId,
      request.kind as "OFFICIAL" | "UNOFFICIAL",
      asOf,
    );
    if (!built.ok) return built;
    const sha = snapshotSha256(built.value);
    const year = Number(asOf.slice(0, 4));
    const seq = schema.transcriptSequences;
    const [allocated] = await db
      .insert(seq)
      .values({ year, nextValue: 2 })
      .onConflictDoUpdate({ target: seq.year, set: { nextValue: sql`${seq.nextValue} + 1` } })
      .returning({ value: sql<number>`${seq.nextValue} - 1` });
    if (allocated === undefined) throw new Error("serial allocation failed");
    const serialNo = `GLIM/TR/${String(year)}/${String(allocated.value).padStart(5, "0")}`;
    const t = schema.transcripts;
    const [transcript] = await db
      .insert(t)
      .values({
        studentId: request.studentId,
        programmeEnrollmentId: request.programmeEnrollmentId,
        requestId: request.id,
        kind: request.kind,
        serialNo,
        verificationCode: verificationCode(),
        asOf,
        issuedBy: actor.userId,
        issuedAt: now,
        snapshot: built.value,
        snapshotSha256: sha,
        createdAt: now,
      })
      .returning({ id: t.id });
    if (transcript === undefined) throw new Error("transcript insert returned nothing");
    // The PDF is rendered from the snapshot after commit (§14.7).
    await tx.boss.send("transcript.generate", { transcriptId: transcript.id });
    const tr = schema.transcriptRequests;
    await db
      .update(tr)
      .set({
        status: "ISSUED",
        decidedBy: request.decidedBy ?? actor.userId,
        decidedAt: request.decidedAt ?? now,
        updatedAt: now,
        version: sql`${tr.version} + 1`,
      })
      .where(eq(tr.id, request.id));
    const [student] = await db
      .select({ userId: schema.students.userId })
      .from(schema.students)
      .where(eq(schema.students.id, request.studentId));
    if (student !== undefined)
      await this.notifications.notify(tx, {
        userId: student.userId,
        kind: "transcript.issued",
        title: `Your ${request.kind === "OFFICIAL" ? "official" : "unofficial"} transcript ${serialNo} is ready`,
        data: { transcriptId: transcript.id, serialNo, kind: request.kind },
        email: request.kind === "OFFICIAL",
        dedupeKey: `transcript-issued:${transcript.id}`,
      });
    await this.audit.record(db, actor, {
      action: "transcript.issued",
      resourceType: "transcript",
      resourceId: transcript.id,
      metadata: {
        requestId: request.id,
        kind: request.kind,
        serialNo,
        snapshotSha256: sha,
        programmeEnrollmentId: request.programmeEnrollmentId,
      },
    });
    return ok(null);
  }

  private async decide(
    requestId: string,
    actor: Actor,
    to: "APPROVED" | "REJECTED",
    reason: string | null,
  ): Promise<DomainResult<TranscriptRequest>> {
    const result = await this.db.withTxResult<null, DomainError>(async (tx) => {
      const tr = schema.transcriptRequests;
      const [row] = await tx.db.select().from(tr).where(eq(tr.id, requestId)).for("update");
      if (row === undefined) return notFound();
      if (row.status === to) return ok(null);
      const allowed = to === "APPROVED" ? ["REQUESTED"] : ["REQUESTED", "APPROVED"];
      if (!allowed.includes(row.status))
        return conflict(`A ${row.status.toLowerCase()} request can't be ${to.toLowerCase()}.`);
      if (to === "APPROVED" && row.kind !== "OFFICIAL")
        return conflict("Unofficial transcripts are issued without approval.");
      const now = this.clock.now();
      await tx.db
        .update(tr)
        .set({
          status: to,
          decidedBy: actor.userId,
          decidedAt: now,
          decisionReason: reason,
          updatedAt: now,
          version: sql`${tr.version} + 1`,
        })
        .where(eq(tr.id, requestId));
      if (to === "REJECTED") {
        const [student] = await tx.db
          .select({ userId: schema.students.userId })
          .from(schema.students)
          .where(eq(schema.students.id, row.studentId));
        if (student !== undefined)
          await this.notifications.notify(tx, {
            userId: student.userId,
            kind: "transcript.request-rejected",
            title: "Your transcript request was declined",
            ...(reason === null ? {} : { body: reason }),
            data: { requestId },
            email: false,
            dedupeKey: `transcript-rejected:${requestId}`,
          });
      }
      await this.audit.record(tx.db, actor, {
        action: to === "APPROVED" ? "transcript.request.approved" : "transcript.request.rejected",
        resourceType: "transcript_request",
        resourceId: requestId,
        metadata: reason === null ? {} : { reason },
      });
      return ok(null);
    });
    return result.ok ? ok(await this.requestView(requestId)) : result;
  }

  private async timezone(db: Database): Promise<string> {
    const [settings] = await db
      .select({ timezone: schema.settings.timezone })
      .from(schema.settings)
      .limit(1);
    return settings?.timezone ?? "Africa/Lagos";
  }

  private async requestView(id: string): Promise<TranscriptRequest> {
    const [found] = await this.requestViews(eq(schema.transcriptRequests.id, id));
    if (found === undefined) throw new Error(`transcript request ${id} vanished`);
    return found;
  }

  private async requestViews(where: SQL | undefined): Promise<TranscriptRequest[]> {
    const tr = schema.transcriptRequests;
    const st = schema.students;
    const pe = schema.programmeEnrollments;
    const t = schema.transcripts;
    const rows = await this.db.read
      .select({
        request: tr,
        given: st.givenName,
        family: st.familyName,
        matricNumber: pe.matricNumber,
        programmeName: schema.programmes.name,
        transcript: {
          id: t.id,
          kind: t.kind,
          serialNo: t.serialNo,
          status: t.status,
          issuedAt: t.issuedAt,
          asOf: t.asOf,
          verificationCode: t.verificationCode,
        },
      })
      .from(tr)
      .innerJoin(st, eq(st.id, tr.studentId))
      .innerJoin(pe, eq(pe.id, tr.programmeEnrollmentId))
      .innerJoin(schema.programmes, eq(schema.programmes.id, pe.programmeId))
      .leftJoin(t, eq(t.requestId, tr.id))
      .where(where)
      .orderBy(desc(tr.createdAt));
    return rows.map((x) => ({
      id: x.request.id,
      programmeEnrollmentId: x.request.programmeEnrollmentId,
      studentName: `${x.given} ${x.family}`,
      matricNumber: x.matricNumber,
      programmeName: x.programmeName,
      kind: x.request.kind as TranscriptRequest["kind"],
      purpose: x.request.purpose,
      recipientName: x.request.recipientName,
      recipientEmail: x.request.recipientEmail,
      status: x.request.status as TranscriptRequest["status"],
      decisionReason: x.request.decisionReason,
      createdAt: x.request.createdAt.toISOString(),
      transcript:
        x.transcript === null
          ? null
          : {
              id: x.transcript.id,
              kind: x.transcript.kind as Transcript["kind"],
              serialNo: x.transcript.serialNo,
              status: x.transcript.status as Transcript["status"],
              issuedAt: x.transcript.issuedAt.toISOString(),
              asOf: x.transcript.asOf,
              verificationCode: x.transcript.verificationCode,
            },
    }));
  }
}
