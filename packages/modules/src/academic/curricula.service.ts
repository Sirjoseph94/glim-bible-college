import type { FieldError } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import {
  CLOCK,
  definedFields,
  domainError,
  err,
  formatDecimal,
  ok,
  parseDecimal,
  type Clock,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, max, sql } from "drizzle-orm";

export type CurriculumRow = typeof schema.curricula.$inferSelect;

/** A course in the curriculum at its place in the default order (ADR-0005). */
export interface Placement {
  courseId: string;
  courseCode: string;
  courseTitle: string;
  position: number;
  /** The override, or the course's own credits. */
  credits: string;
  creditOverride: string | null;
}

/** A placement as the editor sends it: its place is its index in the list. */
export interface PlacementInput {
  courseId: string;
  creditOverride: string | null;
}

export interface CurriculumSummary extends CurriculumRow {
  placementCount: number;
  /** Every course's credits added up: the Certificate needs half of them passed. */
  totalCredits: string;
}

export interface CurriculumDetail extends CurriculumSummary {
  locked: boolean;
  placements: Placement[];
}

/**
 * Whether anyone is enrolled on a curriculum. The enrollment module answers this once programme
 * enrollments exist (ticket 16); until then no curriculum has enrollments.
 */
export type CurriculumUsage = (db: Database, curriculumId: string) => Promise<boolean>;

const locked = () =>
  err(
    domainError(
      "CURRICULUM_LOCKED",
      "This curriculum can't be changed: it's retired, or students are enrolled on it. Clone it to a new version instead.",
    ),
  );
const versionMismatch = () =>
  err(
    domainError("VERSION_MISMATCH", "Someone else changed this curriculum. Reload and try again."),
  );

/**
 * Versioned curricula: DRAFT → ACTIVE → RETIRED, one ACTIVE per programme (TRD §9.1). A curriculum
 * is the programme's courses in their default order; each cohort's schedule starts from it.
 */
@Injectable()
export class CurriculaService {
  private usage: CurriculumUsage = () => Promise.resolve(false);

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Called once by the enrollment module so locking knows about enrollments. */
  registerUsage(usage: CurriculumUsage): void {
    this.usage = usage;
  }

  /** The programme's ACTIVE curriculum, which new enrollments start on (§9.1); null if none. */
  async activeFor(programmeId: string, db: Database = this.db.read): Promise<string | null> {
    const c = schema.curricula;
    const [row] = await db
      .select({ id: c.id })
      .from(c)
      .where(and(eq(c.programmeId, programmeId), eq(c.status, "ACTIVE")));
    return row?.id ?? null;
  }

  async list(programmeId?: string): Promise<CurriculumSummary[]> {
    const c = schema.curricula;
    const cc = schema.curriculumCourses;
    const course = schema.courses;
    const rows = await this.db.read
      .select({
        curriculum: c,
        placementCount: sql<number>`count(${cc.id})::int`,
        totalCredits: sql<string>`coalesce(sum(coalesce(${cc.creditOverride}, ${course.credits})), 0)::numeric(6,1)::text`,
      })
      .from(c)
      .leftJoin(cc, eq(cc.curriculumId, c.id))
      .leftJoin(course, eq(course.id, cc.courseId))
      .where(programmeId === undefined ? undefined : eq(c.programmeId, programmeId))
      .groupBy(c.id)
      .orderBy(asc(c.programmeId), asc(c.curriculumVersion));
    return rows.map((r) => ({
      ...r.curriculum,
      placementCount: r.placementCount,
      totalCredits: r.totalCredits,
    }));
  }

  async get(id: string, db: Database = this.db.read): Promise<CurriculumDetail | null> {
    const [row] = await db.select().from(schema.curricula).where(eq(schema.curricula.id, id));
    if (row === undefined) return null;
    const placements = await this.placementsOf(db, id);
    return {
      ...row,
      placementCount: placements.length,
      totalCredits: totalCredits(placements),
      locked: await this.isLocked(db, row),
      placements,
    };
  }

  async create(
    input: { programmeId: string; effectiveFrom: string },
    actor: AuditActor,
  ): Promise<DomainResult<CurriculumDetail>> {
    return this.db.withTxResult(async ({ db }) => {
      const [programme] = await db
        .select()
        .from(schema.programmes)
        .where(eq(schema.programmes.id, input.programmeId));
      if (programme === undefined) {
        return err(
          domainError("VALIDATION_FAILED", "The programme doesn't exist.", {
            fieldErrors: [field("programmeId", "not_found", "The programme doesn't exist.")],
          }),
        );
      }
      const id = await this.insertVersion(db, input);
      await this.audit.record(db, actor, {
        action: "academic.curriculum.created",
        resourceType: "curriculum",
        resourceId: id,
        metadata: { programmeId: input.programmeId },
      });
      return this.detail(db, id);
    });
  }

  async update(
    id: string,
    expectedVersion: number,
    change: { effectiveFrom?: string | undefined },
    actor: AuditActor,
  ): Promise<DomainResult<CurriculumDetail>> {
    return this.db.withTxResult(async ({ db }) => {
      const current = await this.lockForChange(db, id, expectedVersion);
      if (!current.ok) return current;
      const fields = definedFields(change);
      await this.bump(db, id, fields);
      await this.audit.record(db, actor, {
        action: "academic.curriculum.updated",
        resourceType: "curriculum",
        resourceId: id,
        metadata: fields,
      });
      return this.detail(db, id);
    });
  }

  /**
   * Replaces every placement at once, in the order given, so the editor's whole list (and its
   * order) is one consistent change.
   */
  async replacePlacements(
    id: string,
    expectedVersion: number,
    placements: PlacementInput[],
    actor: AuditActor,
  ): Promise<DomainResult<CurriculumDetail>> {
    return this.db.withTxResult(async ({ db }) => {
      const current = await this.lockForChange(db, id, expectedVersion);
      if (!current.ok) return current;
      const problems = await this.validatePlacements(db, placements);
      if (problems.length > 0) {
        return err(
          domainError("VALIDATION_FAILED", "Some placements are invalid.", {
            fieldErrors: problems,
          }),
        );
      }
      const now = this.clock.now();
      await db
        .delete(schema.curriculumCourses)
        .where(eq(schema.curriculumCourses.curriculumId, id));
      if (placements.length > 0) {
        await db.insert(schema.curriculumCourses).values(
          placements.map((p, i) => ({
            ...p,
            position: i + 1,
            curriculumId: id,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
      await this.bump(db, id, {});
      await this.audit.record(db, actor, {
        action: "academic.curriculum.placements-replaced",
        resourceType: "curriculum",
        resourceId: id,
        metadata: { count: placements.length },
      });
      return this.detail(db, id);
    });
  }

  /** DRAFT → ACTIVE. The programme's previous ACTIVE curriculum is retired in the same change. */
  async activate(id: string, actor: AuditActor): Promise<DomainResult<CurriculumDetail>> {
    return this.db.withTxResult(async ({ db }) => {
      const c = schema.curricula;
      const [row] = await db.select().from(c).where(eq(c.id, id)).for("update");
      if (row === undefined) return err(domainError("NOT_FOUND", "Not found."));
      if (row.status !== "DRAFT")
        return err(domainError("CONFLICT", "Only a draft curriculum can be activated."));
      if ((await this.placementsOf(db, id)).length === 0) {
        return err(domainError("CONFLICT", "Add at least one course before activating."));
      }
      const retired = await db
        .update(c)
        .set({ status: "RETIRED", updatedAt: this.clock.now(), version: sql`${c.version} + 1` })
        .where(and(eq(c.programmeId, row.programmeId), eq(c.status, "ACTIVE")))
        .returning({ id: c.id });
      await this.bump(db, id, { status: "ACTIVE" });
      await this.audit.record(db, actor, {
        action: "academic.curriculum.activated",
        resourceType: "curriculum",
        resourceId: id,
        metadata: { retired: retired.map((r) => r.id) },
      });
      return this.detail(db, id);
    });
  }

  /** Copies a curriculum (any status) into the next draft version for its programme. */
  async clone(
    id: string,
    effectiveFrom: string,
    actor: AuditActor,
  ): Promise<DomainResult<CurriculumDetail>> {
    return this.db.withTxResult(async ({ db }) => {
      const [source] = await db.select().from(schema.curricula).where(eq(schema.curricula.id, id));
      if (source === undefined) return err(domainError("NOT_FOUND", "Not found."));
      const copyId = await this.insertVersion(db, {
        programmeId: source.programmeId,
        effectiveFrom,
      });
      const now = this.clock.now();
      const placements = await db
        .select()
        .from(schema.curriculumCourses)
        .where(eq(schema.curriculumCourses.curriculumId, id));
      if (placements.length > 0) {
        await db.insert(schema.curriculumCourses).values(
          placements.map((p) => ({
            curriculumId: copyId,
            courseId: p.courseId,
            position: p.position,
            creditOverride: p.creditOverride,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
      await this.audit.record(db, actor, {
        action: "academic.curriculum.cloned",
        resourceType: "curriculum",
        resourceId: copyId,
        metadata: { from: id },
      });
      return this.detail(db, copyId);
    });
  }

  private async insertVersion(
    db: Database,
    input: { programmeId: string; effectiveFrom: string },
  ): Promise<string> {
    const c = schema.curricula;
    // Serialise version numbering per programme.
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`glim.curriculum-version:${input.programmeId}`}))`,
    );
    const [{ latest } = { latest: null }] = await db
      .select({ latest: max(c.curriculumVersion) })
      .from(c)
      .where(eq(c.programmeId, input.programmeId));
    const now = this.clock.now();
    const [row] = await db
      .insert(c)
      .values({
        ...input,
        curriculumVersion: (latest ?? 0) + 1,
        status: "DRAFT",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: c.id });
    if (row === undefined) throw new Error("Curriculum insert returned no row");
    return row.id;
  }

  private async lockForChange(
    db: Database,
    id: string,
    expectedVersion: number,
  ): Promise<DomainResult<CurriculumRow>> {
    const [row] = await db
      .select()
      .from(schema.curricula)
      .where(eq(schema.curricula.id, id))
      .for("update");
    if (row === undefined) return err(domainError("NOT_FOUND", "Not found."));
    if (await this.isLocked(db, row)) return locked();
    if (row.version !== expectedVersion) return versionMismatch();
    return ok(row);
  }

  /** RETIRED is always locked; ACTIVE is locked once students are enrolled on it (§9.1). */
  private async isLocked(db: Database, row: CurriculumRow): Promise<boolean> {
    if (row.status === "RETIRED") return true;
    return row.status === "ACTIVE" && (await this.usage(db, row.id));
  }

  private async bump(db: Database, id: string, fields: Record<string, unknown>): Promise<void> {
    const c = schema.curricula;
    await db
      .update(c)
      .set({ ...fields, updatedAt: this.clock.now(), version: sql`${c.version} + 1` })
      .where(eq(c.id, id));
  }

  private async detail(db: Database, id: string): Promise<DomainResult<CurriculumDetail>> {
    const detail = await this.get(id, db);
    return detail === null ? err(domainError("NOT_FOUND", "Not found.")) : ok(detail);
  }

  private async placementsOf(db: Database, curriculumId: string): Promise<Placement[]> {
    const cc = schema.curriculumCourses;
    const course = schema.courses;
    const rows = await db
      .select({ placement: cc, code: course.code, title: course.title, credits: course.credits })
      .from(cc)
      .innerJoin(course, eq(course.id, cc.courseId))
      .where(eq(cc.curriculumId, curriculumId))
      .orderBy(asc(cc.position));
    return rows.map((r) => ({
      courseId: r.placement.courseId,
      courseCode: r.code,
      courseTitle: r.title,
      position: r.placement.position,
      credits: r.placement.creditOverride ?? r.credits,
      creditOverride: r.placement.creditOverride,
    }));
  }

  private async validatePlacements(
    db: Database,
    placements: PlacementInput[],
  ): Promise<FieldError[]> {
    const problems: FieldError[] = [];
    const ids = [...new Set(placements.map((p) => p.courseId))];
    const known =
      ids.length === 0
        ? []
        : await db
            .select({ id: schema.courses.id, status: schema.courses.status })
            .from(schema.courses)
            .where(inArray(schema.courses.id, ids));
    const status = new Map(known.map((k) => [k.id, k.status]));
    const seen = new Set<string>();
    placements.forEach((p, i) => {
      const at = (key: string) => `placements.${String(i)}.${key}`;
      if (!status.has(p.courseId))
        problems.push(field(at("courseId"), "not_found", "That course doesn't exist."));
      else if (status.get(p.courseId) !== "ACTIVE")
        problems.push(field(at("courseId"), "archived", "That course is archived."));
      if (seen.has(p.courseId))
        problems.push(field(at("courseId"), "duplicate", "A course can be placed only once."));
      seen.add(p.courseId);
    });
    return problems;
  }
}

/** Exact: credits are one-decimal values (INV-14). */
function totalCredits(placements: Placement[]): string {
  return formatDecimal(
    placements.reduce((sum, p) => sum + parseDecimal(p.credits, 1), 0),
    1,
  );
}

function field(path: string, code: string, message: string): FieldError {
  return { path: `body.${path}`, code, message };
}
