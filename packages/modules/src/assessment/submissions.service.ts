import type { MySubmissions, Submission, SubmissionForGrading } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { FilesService } from "@glim/modules/content";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { daysLate, isLate, isOpen, suggestedPenaltyPercent, type LateRules } from "./domain/late";
import { toGrade } from "./grades.service";

type AssignmentRow = typeof schema.assignments.$inferSelect;
type SubmissionRow = typeof schema.assignmentSubmissions.$inferSelect;

export interface DraftInput {
  textBody?: string | null | undefined;
  fileIds?: string[] | undefined;
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const closed = () =>
  err(domainError("SUBMISSION_CLOSED", "Submissions for this assignment have closed."));
const noAttemptsLeft = () =>
  err(domainError("ATTEMPT_LIMIT_REACHED", "You've used all your attempts at this assignment."));
const invalid = (path: string, message: string) =>
  err(
    domainError("VALIDATION_FAILED", message, {
      fieldErrors: [{ path, code: "invalid", message }],
    }),
  );

const rulesOf = (a: AssignmentRow): LateRules => ({
  dueAt: a.dueAt,
  cutoffAt: a.cutoffAt,
  allowLate: a.latePolicy.allowLate,
  penaltyPercentPerDay: a.latePolicy.penaltyPercentPerDay,
});

/**
 * Students' submissions (owner: assessment, TRD §14.2). A student writes one draft at a time
 * (text autosaved, files attached) and submits it as an attempt, up to the assignment's limit and
 * until it closes. Lateness is decided here, from the server's clock.
 */
@Injectable()
export class SubmissionsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  /** The caller's attempts; empty and closed for anyone who isn't a student on the course. */
  async mine(assignmentId: string, userId: string): Promise<DomainResult<MySubmissions>> {
    const context = await this.context(this.db.read, assignmentId, userId);
    if (context === null) return ok({ attempts: [], attemptsLeft: 0, open: false });
    const { assignment, studentId } = context;
    const rows = await this.attempts(this.db.read, assignmentId, studentId);
    const submitted = rows.filter((r) => r.status !== "DRAFT").length;
    const attemptsLeft = Math.max(0, assignment.maxAttempts - submitted);
    return ok({
      attempts: await this.views(rows),
      attemptsLeft,
      open:
        assignment.status === "PUBLISHED" &&
        attemptsLeft > 0 &&
        isOpen(rulesOf(assignment), this.clock.now()),
    });
  }

  /** Creates or replaces the draft for the next attempt. */
  async saveDraft(
    assignmentId: string,
    userId: string,
    input: DraftInput,
  ): Promise<DomainResult<Submission>> {
    const result = await this.db.withTxResult(async ({ db }) => {
      const context = await this.context(db, assignmentId, userId, true);
      if (context === null) return notFound();
      const { assignment, studentId } = context;
      const check = await this.canWrite(db, assignment, studentId);
      if (!check.ok) return check;
      if (input.textBody != null && !assignment.submissionTypes.includes("TEXT"))
        return invalid("body.textBody", "This assignment takes files only.");
      if (input.fileIds !== undefined && input.fileIds.length > 0) {
        if (!assignment.submissionTypes.includes("FILE"))
          return invalid("body.fileIds", "This assignment takes text only.");
        for (const fileId of input.fileIds) {
          if (!(await this.files.isUsable(fileId, userId, "SUBMISSION", db)))
            return invalid("body.fileIds", "Upload each file first, then add it.");
          const [file] = await db
            .select({ sizeBytes: schema.files.sizeBytes })
            .from(schema.files)
            .where(eq(schema.files.id, fileId));
          if ((file?.sizeBytes ?? 0) > assignment.maxFileMb * 1024 * 1024)
            return invalid(
              "body.fileIds",
              `Each file must be at most ${String(assignment.maxFileMb)} MB.`,
            );
        }
      }
      const now = this.clock.now();
      const s = schema.assignmentSubmissions;
      let draft = check.value.draft;
      if (draft === null) {
        const [created] = await db
          .insert(s)
          .values({
            assignmentId,
            studentId,
            attemptNo: check.value.submitted + 1,
            textBody: input.textBody ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (created === undefined) throw new Error("draft insert returned nothing");
        draft = created;
      } else if (input.textBody !== undefined) {
        await db
          .update(s)
          .set({ textBody: input.textBody, updatedAt: now, version: sql`${s.version} + 1` })
          .where(eq(s.id, draft.id));
      } else {
        await db.update(s).set({ updatedAt: now }).where(eq(s.id, draft.id));
      }
      if (input.fileIds !== undefined) {
        const sf = schema.submissionFiles;
        await db.delete(sf).where(eq(sf.submissionId, draft.id));
        for (const fileId of new Set(input.fileIds))
          await db.insert(sf).values({ submissionId: draft.id, fileId, createdAt: now });
      }
      return ok(draft.id);
    });
    return result.ok ? ok(await this.view(result.value)) : result;
  }

  /** Submits the draft: the attempt is fixed, timed by the server and flagged if late. */
  async submit(assignmentId: string, userId: string): Promise<DomainResult<Submission>> {
    const result = await this.db.withTxResult(async ({ db }) => {
      const context = await this.context(db, assignmentId, userId, true);
      if (context === null) return notFound();
      const { assignment, studentId } = context;
      const check = await this.canWrite(db, assignment, studentId);
      if (!check.ok) return check;
      const draft = check.value.draft;
      const fileCount =
        draft === null
          ? 0
          : (
              await db
                .select({ id: schema.submissionFiles.id })
                .from(schema.submissionFiles)
                .where(eq(schema.submissionFiles.submissionId, draft.id))
            ).length;
      if (draft === null || ((draft.textBody ?? "").trim() === "" && fileCount === 0))
        return invalid("body", "Add your answer or a file before submitting.");
      const now = this.clock.now();
      const s = schema.assignmentSubmissions;
      await db
        .update(s)
        .set({
          status: "SUBMITTED",
          submittedAt: now,
          isLate: isLate(rulesOf(assignment), now),
          updatedAt: now,
          version: sql`${s.version} + 1`,
        })
        .where(eq(s.id, draft.id));
      return ok(draft.id);
    });
    return result.ok ? ok(await this.view(result.value)) : result;
  }

  /** Every student on the course (ENROLLED or COMPLETED), with their latest attempt and grade. */
  async forGrading(assignmentId: string): Promise<DomainResult<SubmissionForGrading[]>> {
    const [assignment] = await this.db.read
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.id, assignmentId));
    if (assignment === undefined) return notFound();
    const ce = schema.courseEnrollments;
    const st = schema.students;
    const pe = schema.programmeEnrollments;
    const roster = await this.db.read
      .selectDistinct({
        studentId: st.id,
        given: st.givenName,
        family: st.familyName,
        matricNumber: pe.matricNumber,
      })
      .from(ce)
      .innerJoin(st, eq(st.id, ce.studentId))
      .innerJoin(pe, eq(pe.id, ce.programmeEnrollmentId))
      .where(
        and(
          eq(ce.courseOfferingId, assignment.courseOfferingId),
          inArray(ce.status, ["ENROLLED", "COMPLETED"]),
        ),
      )
      .orderBy(asc(st.familyName), asc(st.givenName));
    const ids = roster.map((r) => r.studentId);
    const s = schema.assignmentSubmissions;
    const submitted =
      ids.length === 0
        ? []
        : await this.db.read
            .select()
            .from(s)
            .where(
              and(
                eq(s.assignmentId, assignmentId),
                inArray(s.studentId, ids),
                eq(s.status, "SUBMITTED"),
              ),
            )
            .orderBy(desc(s.attemptNo));
    const g = schema.grades;
    const grades =
      ids.length === 0
        ? []
        : await this.db.read
            .select()
            .from(g)
            .where(and(eq(g.assessmentId, assignment.assessmentId), inArray(g.studentId, ids)));
    const rules = rulesOf(assignment);
    const items: SubmissionForGrading[] = [];
    for (const r of roster) {
      const mineSubmitted = submitted.filter((x) => x.studentId === r.studentId);
      const latest = mineSubmitted[0];
      const grade = grades.find((x) => x.studentId === r.studentId);
      const at = latest?.submittedAt ?? null;
      items.push({
        studentId: r.studentId,
        studentName: `${r.given} ${r.family}`,
        matricNumber: r.matricNumber,
        latest: latest === undefined ? null : await this.view(latest.id),
        submittedAttempts: mineSubmitted.length,
        daysLate: at === null ? 0 : daysLate(rules, at),
        suggestedPenaltyPercent: at === null ? 0 : suggestedPenaltyPercent(rules, at),
        grade: grade === undefined ? null : toGrade(grade),
      });
    }
    return ok(items);
  }

  /** A download URL for a file of a submission, once the caller has been authorized for it. */
  async fileUrl(submissionId: string, fileId: string): Promise<string | null> {
    const sf = schema.submissionFiles;
    const [row] = await this.db.read
      .select({ id: sf.id })
      .from(sf)
      .where(and(eq(sf.submissionId, submissionId), eq(sf.fileId, fileId)));
    if (row === undefined) return null;
    return (await this.files.presignedReadUrls([fileId])).get(fileId) ?? null;
  }

  /** For authorization: the course and the student's user (§7.2). */
  async ownerOf(submissionId: string): Promise<{ offeringId: string; ownerUserId: string } | null> {
    const s = schema.assignmentSubmissions;
    const [row] = await this.db.read
      .select({
        offeringId: schema.assignments.courseOfferingId,
        ownerUserId: schema.students.userId,
      })
      .from(s)
      .innerJoin(schema.assignments, eq(schema.assignments.id, s.assignmentId))
      .innerJoin(schema.students, eq(schema.students.id, s.studentId))
      .where(eq(s.id, submissionId));
    return row ?? null;
  }

  // ---- helpers ----

  /**
   * The assignment and the caller's student record, if the assignment is published and they are
   * on its course. With `lock`, the assignment row is locked so attempts are counted safely.
   */
  private async context(
    db: Database,
    assignmentId: string,
    userId: string,
    lock = false,
  ): Promise<{ assignment: AssignmentRow; studentId: string } | null> {
    const a = schema.assignments;
    const query = db.select().from(a).where(eq(a.id, assignmentId));
    const [assignment] = lock ? await query.for("update") : await query;
    if (assignment === undefined || assignment.status === "DRAFT") return null;
    const ce = schema.courseEnrollments;
    const st = schema.students;
    const [student] = await db
      .select({ id: st.id })
      .from(ce)
      .innerJoin(st, eq(st.id, ce.studentId))
      .where(
        and(
          eq(ce.courseOfferingId, assignment.courseOfferingId),
          eq(st.userId, userId),
          inArray(ce.status, ["ENROLLED", "COMPLETED"]),
        ),
      );
    return student === undefined ? null : { assignment, studentId: student.id };
  }

  private async canWrite(
    db: Database,
    assignment: AssignmentRow,
    studentId: string,
  ): Promise<DomainResult<{ draft: SubmissionRow | null; submitted: number }>> {
    if (assignment.status !== "PUBLISHED" || !isOpen(rulesOf(assignment), this.clock.now()))
      return closed();
    const rows = await this.attempts(db, assignment.id, studentId);
    const submitted = rows.filter((r) => r.status !== "DRAFT").length;
    if (submitted >= assignment.maxAttempts) return noAttemptsLeft();
    return ok({ draft: rows.find((r) => r.status === "DRAFT") ?? null, submitted });
  }

  private attempts(db: Database, assignmentId: string, studentId: string) {
    const s = schema.assignmentSubmissions;
    return db
      .select()
      .from(s)
      .where(and(eq(s.assignmentId, assignmentId), eq(s.studentId, studentId)))
      .orderBy(asc(s.attemptNo));
  }

  private async view(id: string): Promise<Submission> {
    const [row] = await this.db.read
      .select()
      .from(schema.assignmentSubmissions)
      .where(eq(schema.assignmentSubmissions.id, id));
    if (row === undefined) throw new Error(`submission ${id} vanished`);
    const [view] = await this.views([row]);
    if (view === undefined) throw new Error("no view");
    return view;
  }

  private async views(rows: SubmissionRow[]): Promise<Submission[]> {
    if (rows.length === 0) return [];
    const sf = schema.submissionFiles;
    const f = schema.files;
    const files = await this.db.read
      .select({ submissionId: sf.submissionId, file: f })
      .from(sf)
      .innerJoin(f, eq(f.id, sf.fileId))
      .where(
        inArray(
          sf.submissionId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(sf.createdAt), asc(sf.id));
    return rows.map((r) => ({
      id: r.id,
      attemptNo: r.attemptNo,
      status: r.status as Submission["status"],
      textBody: r.textBody,
      files: files
        .filter((x) => x.submissionId === r.id)
        .map(({ file }) => ({
          id: file.id,
          name: file.originalName,
          mime: file.mime,
          sizeBytes: file.sizeBytes,
          downloadPath: `/api/v1/assignment-submissions/${r.id}/files/${file.id}/download`,
        })),
      submittedAt: r.submittedAt?.toISOString() ?? null,
      isLate: r.isLate,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
