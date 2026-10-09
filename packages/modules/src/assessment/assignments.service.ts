import type { Assignment } from "@glim/contracts";
import { Db, schema, type LatePolicy } from "@glim/db";
import { AuthorizationService } from "@glim/modules/authorization";
import { renderMarkdown } from "@glim/modules/content";
import {
  CLOCK,
  definedFields,
  domainError,
  err,
  ok,
  type Clock,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, max, sql, type SQL } from "drizzle-orm";
import { closesAt } from "./domain/late";
import { gradebookLocked, offeringLocked } from "./gradebook-locks";

type AssignmentRow = typeof schema.assignments.$inferSelect;
type AssessmentRow = typeof schema.assessments.$inferSelect;

export interface AssignmentInput {
  title: string;
  instructionsMd: string;
  dueAt: string;
  cutoffAt?: string | null | undefined;
  maxAttempts?: number | undefined;
  latePolicy?: LatePolicy | undefined;
  submissionTypes?: ("FILE" | "TEXT")[] | undefined;
  maxFileMb?: number | undefined;
  maxScore: string;
  weight: string;
}

export type AssignmentChange = { [K in keyof AssignmentInput]?: AssignmentInput[K] | undefined };

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const cutoffBeforeDue = () =>
  err(
    domainError("VALIDATION_FAILED", "The cutoff can't be before the due date.", {
      fieldErrors: [{ path: "body.cutoffAt", code: "invalid", message: "Before the due date." }],
    }),
  );

/**
 * Assignments (owner: assessment, TRD §14.2). Each one backs an ASSIGNMENT assessment, its
 * gradebook column, created and changed in the same transaction.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  /** People who manage the course see drafts too; everyone else published and closed ones. */
  async list(offeringId: string, viewerUserId: string): Promise<Assignment[]> {
    const manages = await this.manages(viewerUserId, offeringId);
    return this.rows(
      and(eq(schema.assignments.courseOfferingId, offeringId), this.visible(manages)),
    );
  }

  async get(id: string, viewerUserId: string): Promise<Assignment | null> {
    const offeringId = await this.offeringOf(id);
    if (offeringId === null) return null;
    const manages = await this.manages(viewerUserId, offeringId);
    const [found] = await this.rows(and(eq(schema.assignments.id, id), this.visible(manages)));
    return found ?? null;
  }

  async create(offeringId: string, input: AssignmentInput): Promise<DomainResult<Assignment>> {
    const dueAt = new Date(input.dueAt);
    const cutoffAt = input.cutoffAt == null ? null : new Date(input.cutoffAt);
    if (cutoffAt !== null && cutoffAt < dueAt) return cutoffBeforeDue();
    if (await offeringLocked(this.db.read, offeringId)) return err(gradebookLocked());
    const id = await this.db.withTx(async ({ db }) => {
      const a = schema.assessments;
      const [last] = await db
        .select({ position: max(a.position) })
        .from(a)
        .where(eq(a.courseOfferingId, offeringId));
      const now = this.clock.now();
      const [assessment] = await db
        .insert(a)
        .values({
          courseOfferingId: offeringId,
          kind: "ASSIGNMENT",
          title: input.title,
          maxScore: input.maxScore,
          weight: input.weight,
          position: (last?.position ?? -1) + 1,
          dueAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: a.id });
      if (assessment === undefined) throw new Error("assessment insert returned nothing");
      const [row] = await db
        .insert(schema.assignments)
        .values({
          courseOfferingId: offeringId,
          assessmentId: assessment.id,
          instructionsMd: input.instructionsMd,
          dueAt,
          cutoffAt,
          maxAttempts: input.maxAttempts ?? 1,
          latePolicy: input.latePolicy ?? { allowLate: false },
          submissionTypes: input.submissionTypes ?? ["FILE", "TEXT"],
          maxFileMb: input.maxFileMb ?? 20,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: schema.assignments.id });
      if (row === undefined) throw new Error("assignment insert returned nothing");
      return row.id;
    });
    return ok(await this.one(id));
  }

  async update(
    id: string,
    expectedVersion: number,
    change: AssignmentChange,
  ): Promise<DomainResult<Assignment>> {
    const result = await this.db.withTxResult(async ({ db }) => {
      const s = schema.assignments;
      const [row] = await db.select().from(s).where(eq(s.id, id)).for("update");
      if (row === undefined) return notFound();
      if (row.version !== expectedVersion)
        return err(
          domainError("VERSION_MISMATCH", "Someone else changed this assignment. Reload it."),
        );
      const dueAt = change.dueAt === undefined ? row.dueAt : new Date(change.dueAt);
      const cutoffAt =
        change.cutoffAt === undefined
          ? row.cutoffAt
          : change.cutoffAt === null
            ? null
            : new Date(change.cutoffAt);
      if (cutoffAt !== null && cutoffAt < dueAt) return cutoffBeforeDue();
      if (
        (change.weight !== undefined || change.maxScore !== undefined) &&
        (await offeringLocked(db, row.courseOfferingId))
      )
        return err(gradebookLocked());
      const now = this.clock.now();
      await db
        .update(s)
        .set({
          ...definedFields({
            instructionsMd: change.instructionsMd,
            maxAttempts: change.maxAttempts,
            latePolicy: change.latePolicy,
            submissionTypes: change.submissionTypes,
            maxFileMb: change.maxFileMb,
          }),
          dueAt,
          cutoffAt,
          updatedAt: now,
          version: sql`${s.version} + 1`,
        })
        .where(eq(s.id, id));
      const a = schema.assessments;
      await db
        .update(a)
        .set({
          ...definedFields({
            title: change.title,
            maxScore: change.maxScore,
            weight: change.weight,
          }),
          dueAt,
          updatedAt: now,
          version: sql`${a.version} + 1`,
        })
        .where(eq(a.id, row.assessmentId));
      return ok(null);
    });
    return result.ok ? ok(await this.one(id)) : result;
  }

  /** DRAFT → PUBLISHED, with its gradebook column; publishing again changes nothing. */
  async publish(id: string): Promise<DomainResult<Assignment>> {
    const result = await this.db.withTxResult(async ({ db }) => {
      const s = schema.assignments;
      const [row] = await db.select().from(s).where(eq(s.id, id)).for("update");
      if (row === undefined) return notFound();
      if (row.status !== "DRAFT") return ok(null);
      if (await offeringLocked(db, row.courseOfferingId)) return err(gradebookLocked());
      const now = this.clock.now();
      await db
        .update(s)
        .set({ status: "PUBLISHED", updatedAt: now, version: sql`${s.version} + 1` })
        .where(eq(s.id, id));
      const a = schema.assessments;
      await db
        .update(a)
        .set({ status: "PUBLISHED", updatedAt: now, version: sql`${a.version} + 1` })
        .where(eq(a.id, row.assessmentId));
      return ok(null);
    });
    return result.ok ? ok(await this.one(id)) : result;
  }

  async offeringOf(id: string): Promise<string | null> {
    const s = schema.assignments;
    const [row] = await this.db.read
      .select({ offeringId: s.courseOfferingId })
      .from(s)
      .where(eq(s.id, id));
    return row?.offeringId ?? null;
  }

  async offeringOfAssessment(id: string): Promise<string | null> {
    const a = schema.assessments;
    const [row] = await this.db.read
      .select({ offeringId: a.courseOfferingId })
      .from(a)
      .where(eq(a.id, id));
    return row?.offeringId ?? null;
  }

  // ---- helpers ----

  private visible(manages: boolean): SQL | undefined {
    return manages ? undefined : inArray(schema.assignments.status, ["PUBLISHED", "CLOSED"]);
  }

  private async manages(userId: string, offeringId: string): Promise<boolean> {
    const decision = await this.authorization.authorize(
      this.authorization.principal(userId),
      "assessment:assignment:manage",
      { type: "course-offering", id: offeringId },
    );
    return decision === "ALLOW";
  }

  private async rows(where: SQL | undefined): Promise<Assignment[]> {
    const s = schema.assignments;
    const a = schema.assessments;
    const rows = await this.db.read
      .select({ assignment: s, assessment: a })
      .from(s)
      .innerJoin(a, eq(a.id, s.assessmentId))
      .where(where)
      .orderBy(asc(s.dueAt), asc(s.id));
    return rows.map((r) => toAssignment(r.assignment, r.assessment));
  }

  private async one(id: string): Promise<Assignment> {
    const [found] = await this.rows(eq(schema.assignments.id, id));
    if (found === undefined) throw new Error(`assignment ${id} vanished`);
    return found;
  }
}

export function toAssignment(row: AssignmentRow, assessment: AssessmentRow): Assignment {
  const closes = closesAt({
    dueAt: row.dueAt,
    cutoffAt: row.cutoffAt,
    allowLate: row.latePolicy.allowLate,
  });
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    courseOfferingId: row.courseOfferingId,
    title: assessment.title,
    instructionsMd: row.instructionsMd,
    instructionsHtml: renderMarkdown(row.instructionsMd),
    dueAt: row.dueAt.toISOString(),
    cutoffAt: row.cutoffAt?.toISOString() ?? null,
    closesAt: closes?.toISOString() ?? null,
    maxAttempts: row.maxAttempts,
    latePolicy: row.latePolicy,
    submissionTypes: row.submissionTypes as Assignment["submissionTypes"],
    maxFileMb: row.maxFileMb,
    maxScore: assessment.maxScore,
    weight: assessment.weight,
    status: row.status as Assignment["status"],
    version: row.version,
  };
}
