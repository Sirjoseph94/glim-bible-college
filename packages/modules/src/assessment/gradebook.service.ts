import type { Gradebook, GradebookColumn, GradebookRow, MyGrade } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import type { AuditActor } from "@glim/modules/audit";
import { AuditService } from "@glim/modules/audit";
import { renderMarkdown } from "@glim/modules/content";
import { NotificationsService } from "@glim/modules/notifications";
import {
  CLOCK,
  definedFields,
  domainError,
  err,
  formatDecimal,
  ok,
  parseCsv,
  parseDecimal,
  type Clock,
  type DomainError,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNotNull, max, sql } from "drizzle-orm";
import { attemptsScore } from "./exam-scores";
import { GradesService, normaliseScore, switchesPath, toGrade } from "./grades.service";

type AssessmentRow = typeof schema.assessments.$inferSelect;

/** Columns whose weights count toward the final result (§14.3). */
const COUNTED = ["PUBLISHED", "CLOSED"];
/** 100.00 %, in hundredths. */
const FULL_WEIGHT = 10_000;

export interface GradeImportRow {
  line: number;
  matricNumber: string;
  studentName: string | null;
  oldScore: string | null;
  newScore: string | null;
  outcome: "created" | "updated" | "unchanged" | "error";
  message: string | null;
}

export interface GradeImportResult {
  applied: boolean;
  rows: GradeImportRow[];
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/** The weights of the counted columns, in hundredths: finalization needs exactly 100.00. */
export function weightTotal(columns: { weight: string; status: string }[]): number {
  return columns
    .filter((c) => COUNTED.includes(c.status))
    .reduce((sum, c) => sum + parseDecimal(c.weight, 2), 0);
}

/**
 * The gradebook (owner: assessment, TRD §14.2): one per course offering, a column per assessment
 * and a row per student on the course. Lecturers add hand-entered columns, import a column's
 * scores from CSV, and release each column's grades when they're ready; students only ever see
 * released grades.
 */
@Injectable()
export class GradebookService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(GradesService) private readonly grades: GradesService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async view(offeringId: string): Promise<Gradebook> {
    const columns = await this.columns(this.db.read, offeringId);
    const roster = await this.roster(this.db.read, offeringId);
    const g = schema.grades;
    const grades =
      roster.length === 0
        ? []
        : await this.db.read
            .select()
            .from(g)
            .where(
              and(
                eq(g.courseOfferingId, offeringId),
                inArray(
                  g.studentId,
                  roster.map((r) => r.studentId),
                ),
              ),
            );
    const online = await this.onlineScores(
      columns,
      roster.map((r) => r.studentId),
    );
    const rows: GradebookRow[] = roster.map((r) => ({
      studentId: r.studentId,
      studentName: `${r.given} ${r.family}`,
      matricNumber: r.matricNumber,
      studyMode: r.studyMode as GradebookRow["studyMode"],
      grades: grades
        .filter((x) => x.studentId === r.studentId)
        .map((x) => ({ ...toGrade(x), assessmentId: x.assessmentId })),
      onlineScores: online
        .filter((o) => o.studentId === r.studentId)
        .map((o) => ({ assessmentId: o.assessmentId, score: formatDecimal(o.scoreX100, 2) })),
    }));
    const total = weightTotal(columns);
    return {
      columns,
      rows,
      weightTotal: formatDecimal(total, 2),
      weightsValid: total === FULL_WEIGHT,
    };
  }

  /**
   * The weights check finalization runs (§14.2): the published and closed columns must add up to
   * exactly 100.00.
   */
  async checkWeights(db: Database, offeringId: string): Promise<DomainResult<null>> {
    const total = weightTotal(await this.columns(db, offeringId));
    if (total === FULL_WEIGHT) return ok(null);
    return err(
      domainError(
        "WEIGHTS_NOT_100",
        `The gradebook's weights add up to ${formatDecimal(total, 2)} %, not 100 %.`,
      ),
    );
  }

  /** A hand-entered column (kind MANUAL), published straight away. */
  async createColumn(
    offeringId: string,
    input: { title: string; maxScore: string; weight: string },
    actor: AuditActor,
  ): Promise<GradebookColumn> {
    const id = await this.db.withTx(async ({ db }) => {
      const a = schema.assessments;
      const [last] = await db
        .select({ position: max(a.position) })
        .from(a)
        .where(eq(a.courseOfferingId, offeringId));
      const now = this.clock.now();
      const [row] = await db
        .insert(a)
        .values({
          courseOfferingId: offeringId,
          kind: "MANUAL",
          title: input.title,
          maxScore: input.maxScore,
          weight: input.weight,
          position: (last?.position ?? -1) + 1,
          status: "PUBLISHED",
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: a.id });
      if (row === undefined) throw new Error("assessment insert returned nothing");
      await this.audit.record(db, actor, {
        action: "assessment.column.created",
        resourceType: "assessment",
        resourceId: row.id,
        metadata: {
          offeringId,
          title: input.title,
          maxScore: input.maxScore,
          weight: input.weight,
        },
      });
      return row.id;
    });
    return this.column(id);
  }

  /** Renames a column or changes its weight; the maximum score belongs to its assignment or quiz. */
  async updateColumn(
    assessmentId: string,
    expectedVersion: number,
    change: { title?: string | undefined; weight?: string | undefined },
    actor: AuditActor,
  ): Promise<DomainResult<GradebookColumn>> {
    const result = await this.db.withTxResult<null, DomainError>(async ({ db }) => {
      const a = schema.assessments;
      const [row] = await db.select().from(a).where(eq(a.id, assessmentId)).for("update");
      if (row === undefined) return notFound();
      if (row.version !== expectedVersion)
        return err(
          domainError(
            "VERSION_MISMATCH",
            "Someone else changed this column. Reload and try again.",
          ),
        );
      await db
        .update(a)
        .set({
          ...definedFields({ title: change.title, weight: change.weight }),
          updatedAt: this.clock.now(),
          version: sql`${a.version} + 1`,
        })
        .where(eq(a.id, assessmentId));
      await this.audit.record(db, actor, {
        action: "assessment.column.updated",
        resourceType: "assessment",
        resourceId: assessmentId,
        metadata: {
          ...(change.title === undefined ? {} : { oldTitle: row.title, title: change.title }),
          ...(change.weight === undefined ? {} : { oldWeight: row.weight, weight: change.weight }),
        },
      });
      return ok(null);
    });
    return result.ok ? ok(await this.column(assessmentId)) : result;
  }

  /**
   * Releases the column's scored DRAFT grades: students see them from now on and get an in-app
   * notice. Grades entered later stay DRAFT until the next release; releasing again with nothing
   * new changes nothing.
   */
  async release(
    assessmentId: string,
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<{ released: number; column: GradebookColumn }>> {
    const result = await this.db.withTxResult<number, DomainError>(async (tx) => {
      const a = schema.assessments;
      const [assessment] = await tx.db.select().from(a).where(eq(a.id, assessmentId)).for("update");
      if (assessment === undefined) return notFound();
      const g = schema.grades;
      const pending = await tx.db
        .select()
        .from(g)
        .where(and(eq(g.assessmentId, assessmentId), eq(g.status, "DRAFT"), isNotNull(g.score)))
        .for("update");
      if (pending.length === 0) return ok(0);
      const now = this.clock.now();
      await tx.db
        .update(g)
        .set({
          status: "RELEASED",
          releasedAt: now,
          updatedAt: now,
          version: sql`${g.version} + 1`,
        })
        .where(
          inArray(
            g.id,
            pending.map((p) => p.id),
          ),
        );
      await tx.db.insert(schema.gradeChanges).values(
        pending.map((p) => ({
          gradeId: p.id,
          oldScore: p.score,
          newScore: p.score,
          oldStatus: "DRAFT",
          newStatus: "RELEASED",
          oldSource: p.source,
          newSource: p.source,
          changedBy: actor.userId,
          createdAt: now,
        })),
      );
      await this.audit.record(tx.db, actor, {
        action: "assessment.grades.released",
        resourceType: "assessment",
        resourceId: assessmentId,
        metadata: { count: pending.length, gradeIds: pending.map((p) => p.id) },
      });
      const st = schema.students;
      const users = await tx.db
        .select({ studentId: st.id, userId: st.userId })
        .from(st)
        .where(
          inArray(
            st.id,
            pending.map((p) => p.studentId),
          ),
        );
      const code = await this.courseCode(tx.db, assessment.courseOfferingId);
      for (const p of pending) {
        const userId = users.find((u) => u.studentId === p.studentId)?.userId;
        if (userId === undefined) continue;
        await this.notifications.notify(tx, {
          userId,
          kind: "assessment.grade-released",
          title: `${code}: your grade for ${assessment.title} is out`,
          data: { offeringId: assessment.courseOfferingId, assessmentId },
          email: false,
          dedupeKey: `grade-released:${p.id}`,
        });
      }
      return ok(pending.length);
    });
    return result.ok
      ? ok({ released: result.value, column: await this.column(assessmentId) })
      : result;
  }

  /**
   * Imports one column's scores from CSV with the headers `matric_number`, `score` and optionally
   * `feedback`. Every row is checked first; nothing is saved on a dry run or if any row has an
   * error. Imported scores have source IMPORT; changing a released one keeps it released.
   */
  async importCsv(
    offeringId: string,
    input: { assessmentId: string; csv: string; dryRun: boolean },
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<GradeImportResult>> {
    return this.db.withTxResult<GradeImportResult, DomainError>(async ({ db }) => {
      const a = schema.assessments;
      const [assessment] = await db
        .select()
        .from(a)
        .where(and(eq(a.id, input.assessmentId), eq(a.courseOfferingId, offeringId)));
      if (assessment === undefined)
        return err(
          domainError("VALIDATION_FAILED", "Choose a column of this course.", {
            fieldErrors: [
              { path: "body.assessmentId", code: "invalid", message: "Not a column here." },
            ],
          }),
        );
      const [header = [], ...body] = parseCsv(input.csv);
      const names = header.map((h) => h.trim().toLowerCase());
      const matricAt = names.indexOf("matric_number");
      const scoreAt = names.indexOf("score");
      const feedbackAt = names.indexOf("feedback");
      if (matricAt < 0 || scoreAt < 0)
        return err(
          domainError(
            "VALIDATION_FAILED",
            "The first line must name the columns matric_number and score (feedback is optional).",
            { fieldErrors: [{ path: "body.csv", code: "invalid", message: "Missing headers." }] },
          ),
        );
      if (body.length > 2000)
        return err(
          domainError("VALIDATION_FAILED", "Import at most 2,000 rows at a time.", {
            fieldErrors: [{ path: "body.csv", code: "too_big", message: "Too many rows." }],
          }),
        );

      const roster = new Map(
        (await this.roster(db, offeringId)).map((r) => [r.matricNumber.toUpperCase(), r]),
      );
      const seen = new Set<string>();
      const plan: {
        row: GradeImportRow;
        studentId: string;
        score: string;
        feedback: string | undefined;
      }[] = [];
      const rows: GradeImportRow[] = [];
      for (const [i, cells] of body.entries()) {
        const matric = (cells[matricAt] ?? "").trim().toUpperCase();
        const row: GradeImportRow = {
          line: i + 2,
          matricNumber: matric,
          studentName: null,
          oldScore: null,
          newScore: null,
          outcome: "error",
          message: null,
        };
        rows.push(row);
        const student = roster.get(matric);
        if (matric === "" || student === undefined) {
          row.message = "No student on this course has that Matric Number.";
          continue;
        }
        row.studentName = `${student.given} ${student.family}`;
        if (seen.has(matric)) {
          row.message = "This Matric Number is on an earlier line too.";
          continue;
        }
        seen.add(matric);
        const checked = normaliseScore(cells[scoreAt] ?? "", assessment.maxScore);
        if ("message" in checked) {
          row.message = checked.message;
          continue;
        }
        const feedbackText = feedbackAt < 0 ? "" : (cells[feedbackAt] ?? "").trim();
        if (feedbackText.length > 20_000) {
          row.message = "The feedback is too long.";
          continue;
        }
        row.newScore = checked.score;
        plan.push({
          row,
          studentId: student.studentId,
          score: checked.score,
          feedback: feedbackText === "" ? undefined : feedbackText,
        });
      }

      const g = schema.grades;
      const existing =
        plan.length === 0
          ? []
          : await db
              .select()
              .from(g)
              .where(
                and(
                  eq(g.assessmentId, assessment.id),
                  inArray(
                    g.studentId,
                    plan.map((p) => p.studentId),
                  ),
                ),
              )
              .for("update");
      for (const p of plan) {
        const current = existing.find((x) => x.studentId === p.studentId);
        p.row.oldScore = current?.score ?? null;
        if (switchesPath(current, "IMPORT", p.score)) {
          p.row.outcome = "error";
          p.row.message =
            "This student has an online exam score; replace it in the gradebook with a reason.";
          continue;
        }
        p.row.outcome =
          current === undefined
            ? "created"
            : current.score === p.score &&
                current.status !== "EXCUSED" &&
                (p.feedback === undefined || p.feedback === current.feedbackMd)
              ? "unchanged"
              : "updated";
      }

      const errors = rows.filter((r) => r.outcome === "error").length;
      const apply = !input.dryRun && errors === 0;
      if (apply)
        for (const p of plan) {
          if (p.row.outcome !== "created" && p.row.outcome !== "updated") continue;
          const current = existing.find((x) => x.studentId === p.studentId);
          const released = current?.status === "RELEASED";
          await this.grades.write(db, {
            assessment,
            studentId: p.studentId,
            current,
            next: {
              score: p.score,
              status: released ? "RELEASED" : "DRAFT",
              source: "IMPORT",
              feedbackMd: p.feedback,
              gradedBy: actor.userId,
              releasedAt: released ? current.releasedAt : null,
            },
            changedBy: actor.userId,
            reason: "Imported from CSV",
            action: "assessment.grade.imported",
            actor,
          });
        }
      return ok({
        applied: apply,
        rows,
        created: rows.filter((r) => r.outcome === "created").length,
        updated: rows.filter((r) => r.outcome === "updated").length,
        unchanged: rows.filter((r) => r.outcome === "unchanged").length,
        errors,
      });
    });
  }

  /** The caller's released (and excused) grades on a course; nothing for anyone not on it. */
  async mine(offeringId: string, userId: string): Promise<MyGrade[]> {
    const g = schema.grades;
    const a = schema.assessments;
    const st = schema.students;
    const rows = await this.db.read
      .select({ grade: g, assessment: a })
      .from(g)
      .innerJoin(a, eq(a.id, g.assessmentId))
      .innerJoin(st, eq(st.id, g.studentId))
      .where(
        and(
          eq(g.courseOfferingId, offeringId),
          eq(st.userId, userId),
          inArray(g.status, ["RELEASED", "EXCUSED"]),
        ),
      )
      .orderBy(asc(a.position));
    return rows.map(({ grade, assessment }) => ({
      assessmentId: assessment.id,
      kind: assessment.kind as MyGrade["kind"],
      title: assessment.title,
      maxScore: assessment.maxScore,
      weight: assessment.weight,
      score: grade.status === "RELEASED" ? grade.score : null,
      excused: grade.status === "EXCUSED",
      feedbackHtml:
        grade.status === "RELEASED" && grade.feedbackMd !== null
          ? renderMarkdown(grade.feedbackMd)
          : null,
      releasedAt: grade.releasedAt?.toISOString() ?? null,
    }));
  }

  async column(assessmentId: string): Promise<GradebookColumn> {
    const [row] = await this.db.read
      .select()
      .from(schema.assessments)
      .where(eq(schema.assessments.id, assessmentId));
    if (row === undefined) throw new Error("column vanished");
    const [found] = await this.withCounts(this.db.read, [row]);
    if (found === undefined) throw new Error("column vanished");
    return found;
  }

  // ---- helpers ----

  private async columns(db: Database, offeringId: string): Promise<GradebookColumn[]> {
    const a = schema.assessments;
    const rows = await db
      .select()
      .from(a)
      .where(eq(a.courseOfferingId, offeringId))
      .orderBy(asc(a.position), asc(a.createdAt));
    return this.withCounts(db, rows);
  }

  private async withCounts(db: Database, rows: AssessmentRow[]): Promise<GradebookColumn[]> {
    const g = schema.grades;
    const counts =
      rows.length === 0
        ? []
        : await db
            .select({
              assessmentId: g.assessmentId,
              unreleased: sql<number>`count(*) filter (where ${g.status} = 'DRAFT' and ${g.score} is not null)::int`,
              released: sql<number>`count(*) filter (where ${g.status} = 'RELEASED')::int`,
            })
            .from(g)
            .where(
              inArray(
                g.assessmentId,
                rows.map((r) => r.id),
              ),
            )
            .groupBy(g.assessmentId);
    const exams = rows.filter((r) => r.kind === "EXAM").map((r) => r.id);
    const z = schema.quizzes;
    const online =
      exams.length === 0
        ? []
        : await db
            .select({ id: z.id, assessmentId: z.assessmentId })
            .from(z)
            .where(inArray(z.assessmentId, exams));
    return rows.map((r) => {
      const c = counts.find((x) => x.assessmentId === r.id);
      return {
        assessmentId: r.id,
        kind: r.kind as GradebookColumn["kind"],
        title: r.title,
        maxScore: r.maxScore,
        weight: r.weight,
        status: r.status as GradebookColumn["status"],
        dueAt: r.dueAt?.toISOString() ?? null,
        unreleased: c?.unreleased ?? 0,
        released: c?.released ?? 0,
        onlineQuizId: online.find((o) => o.assessmentId === r.id)?.id ?? null,
        version: r.version,
      };
    });
  }

  /** Each student's online exam score per EXAM column with an online part they've sat. */
  private async onlineScores(
    columns: GradebookColumn[],
    studentIds: string[],
  ): Promise<{ assessmentId: string; studentId: string; scoreX100: number }[]> {
    const quizIds = columns.flatMap((c) => (c.onlineQuizId === null ? [] : [c.onlineQuizId]));
    if (quizIds.length === 0 || studentIds.length === 0) return [];
    const z = schema.quizzes;
    const quizzes = await this.db.read.select().from(z).where(inArray(z.id, quizIds));
    const a = schema.quizAttempts;
    const sat = await this.db.read
      .selectDistinct({ quizId: a.quizId, studentId: a.studentId })
      .from(a)
      .where(and(inArray(a.quizId, quizIds), inArray(a.studentId, studentIds), isNotNull(a.score)));
    const out: { assessmentId: string; studentId: string; scoreX100: number }[] = [];
    for (const s of sat) {
      const quiz = quizzes.find((q) => q.id === s.quizId);
      if (quiz === undefined) continue;
      const scoreX100 = await attemptsScore(this.db.read, quiz, s.studentId);
      if (scoreX100 !== null)
        out.push({ assessmentId: quiz.assessmentId, studentId: s.studentId, scoreX100 });
    }
    return out;
  }

  private async roster(db: Database, offeringId: string) {
    const ce = schema.courseEnrollments;
    const st = schema.students;
    const pe = schema.programmeEnrollments;
    return db
      .selectDistinct({
        studentId: st.id,
        given: st.givenName,
        family: st.familyName,
        matricNumber: pe.matricNumber,
        studyMode: pe.studyMode,
      })
      .from(ce)
      .innerJoin(st, eq(st.id, ce.studentId))
      .innerJoin(pe, eq(pe.id, ce.programmeEnrollmentId))
      .where(
        and(eq(ce.courseOfferingId, offeringId), inArray(ce.status, ["ENROLLED", "COMPLETED"])),
      )
      .orderBy(asc(st.familyName), asc(st.givenName));
  }

  private async courseCode(db: Database, offeringId: string): Promise<string> {
    const [row] = await db
      .select({ code: schema.courses.code })
      .from(schema.courseOfferings)
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseOfferings.courseId))
      .where(eq(schema.courseOfferings.id, offeringId));
    return row?.code ?? "";
  }
}
