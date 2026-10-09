import type { GradingScheme } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import {
  CLOCK,
  definedFields,
  domainError,
  err,
  ok,
  type Clock,
  type DomainError,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { validateScheme, type SchemeRules } from "./domain/grading";

type SchemeRow = typeof schema.gradingSchemes.$inferSelect;

export interface SchemeInput extends SchemeRules {
  name: string;
  kind: "NUC_5" | "CUSTOM";
}

export type SchemeChange = { [K in keyof SchemeInput]?: SchemeInput[K] | undefined };

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/** The scheme's rules as the pure functions take them. */
export function rulesOf(row: SchemeRow): SchemeRules {
  return {
    bands: row.bands,
    classBands: row.classBands,
    minAwardCgpaX100: row.minAwardCgpaX100,
    maxPointsX100: row.maxPointsX100,
    passMarkX100: row.passMarkX100,
    repeatPolicy: row.repeatPolicy as SchemeRules["repeatPolicy"],
    goodStandingCgpaX100: row.goodStandingCgpaX100,
    probationCgpaX100: row.probationCgpaX100,
  };
}

function invalid(problems: { path: string; message: string }[]): DomainError {
  return domainError("VALIDATION_FAILED", problems[0]?.message ?? "Check the scheme.", {
    fieldErrors: problems.map((p) => ({
      path: `body.${p.path}`,
      code: "invalid",
      message: p.message,
    })),
  });
}

/**
 * Grading schemes (owner: results, TRD §14.4). The Registrar keeps them; a scheme is locked by the
 * first result graded with it, after which a change is a new version that its programmes move to.
 * Results already finalized keep the version they were graded with.
 */
@Injectable()
export class GradingSchemesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(): Promise<GradingScheme[]> {
    const rows = await this.db.read
      .select()
      .from(schema.gradingSchemes)
      .orderBy(desc(schema.gradingSchemes.createdAt), asc(schema.gradingSchemes.name));
    return this.views(this.db.read, rows);
  }

  async get(id: string): Promise<GradingScheme | null> {
    const [row] = await this.db.read
      .select()
      .from(schema.gradingSchemes)
      .where(eq(schema.gradingSchemes.id, id));
    if (row === undefined) return null;
    const [view] = await this.views(this.db.read, [row]);
    return view ?? null;
  }

  async create(
    input: SchemeInput & { supersedesId?: string | undefined },
    actor: AuditActor,
  ): Promise<DomainResult<GradingScheme>> {
    const problems = validateScheme(input);
    if (problems.length > 0) return err(invalid(problems));
    const result = await this.db.withTxResult<string, DomainError>(async ({ db }) => {
      const g = schema.gradingSchemes;
      if (input.supersedesId !== undefined) {
        const [old] = await db.select({ id: g.id }).from(g).where(eq(g.id, input.supersedesId));
        if (old === undefined)
          return err(
            domainError("VALIDATION_FAILED", "The scheme being replaced doesn't exist.", {
              fieldErrors: [{ path: "body.supersedesId", code: "invalid", message: "Unknown." }],
            }),
          );
      }
      const now = this.clock.now();
      const [row] = await db
        .insert(g)
        .values({
          name: input.name,
          kind: input.kind,
          bands: sorted(input.bands),
          classBands: [...input.classBands].sort((a, b) => b.minCgpaX100 - a.minCgpaX100),
          minAwardCgpaX100: input.minAwardCgpaX100,
          maxPointsX100: input.maxPointsX100,
          passMarkX100: input.passMarkX100,
          repeatPolicy: input.repeatPolicy,
          goodStandingCgpaX100: input.goodStandingCgpaX100,
          probationCgpaX100: input.probationCgpaX100,
          supersedesId: input.supersedesId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: g.name })
        .returning({ id: g.id });
      if (row === undefined)
        return err(
          domainError("CONFLICT", `A scheme called ${input.name} already exists.`, {
            fieldErrors: [{ path: "body.name", code: "taken", message: "Name taken." }],
          }),
        );
      let moved: string[] = [];
      if (input.supersedesId !== undefined) {
        const p = schema.programmes;
        moved = (
          await db
            .update(p)
            .set({ gradingSchemeId: row.id, updatedAt: now, version: sql`${p.version} + 1` })
            .where(eq(p.gradingSchemeId, input.supersedesId))
            .returning({ id: p.id })
        ).map((x) => x.id);
      }
      await this.audit.record(db, actor, {
        action: "results.scheme.created",
        resourceType: "grading_scheme",
        resourceId: row.id,
        metadata: {
          name: input.name,
          ...(input.supersedesId === undefined
            ? {}
            : { supersedesId: input.supersedesId, programmesMoved: moved }),
        },
      });
      return ok(row.id);
    });
    return result.ok ? ok(await this.must(result.value)) : result;
  }

  /** Changes a scheme in place, only while no result has used it. */
  async update(
    id: string,
    expectedVersion: number,
    change: SchemeChange,
    actor: AuditActor,
  ): Promise<DomainResult<GradingScheme>> {
    const result = await this.db.withTxResult<null, DomainError>(async ({ db }) => {
      const g = schema.gradingSchemes;
      const [row] = await db.select().from(g).where(eq(g.id, id)).for("update");
      if (row === undefined) return notFound();
      if (row.lockedAt !== null)
        return err(
          domainError(
            "SCHEME_LOCKED",
            "Results have been graded with this scheme, so it can't change. Save your changes as a new version instead.",
          ),
        );
      if (row.version !== expectedVersion)
        return err(
          domainError(
            "VERSION_MISMATCH",
            "Someone else changed this scheme. Reload and try again.",
          ),
        );
      const fields = definedFields(change);
      const next = { ...rulesOf(row), ...fields };
      const problems = validateScheme(next);
      if (problems.length > 0) return err(invalid(problems));
      if (change.name !== undefined && change.name !== row.name) {
        const [taken] = await db.select({ id: g.id }).from(g).where(eq(g.name, change.name));
        if (taken !== undefined)
          return err(
            domainError("CONFLICT", `A scheme called ${change.name} already exists.`, {
              fieldErrors: [{ path: "body.name", code: "taken", message: "Name taken." }],
            }),
          );
      }
      await db
        .update(g)
        .set({
          ...fields,
          ...(change.bands === undefined ? {} : { bands: sorted(change.bands) }),
          updatedAt: this.clock.now(),
          version: sql`${g.version} + 1`,
        })
        .where(eq(g.id, id));
      await this.audit.record(db, actor, {
        action: "results.scheme.updated",
        resourceType: "grading_scheme",
        resourceId: id,
        metadata: { fields: Object.keys(fields) },
      });
      return ok(null);
    });
    return result.ok ? ok(await this.must(id)) : result;
  }

  /** Points a programme at a scheme; results already finalized keep theirs. */
  async assign(
    programmeId: string,
    schemeId: string,
    actor: AuditActor,
  ): Promise<DomainResult<GradingScheme>> {
    const result = await this.db.withTxResult<null, DomainError>(async ({ db }) => {
      const [scheme] = await db
        .select({ id: schema.gradingSchemes.id })
        .from(schema.gradingSchemes)
        .where(eq(schema.gradingSchemes.id, schemeId));
      if (scheme === undefined)
        return err(
          domainError("VALIDATION_FAILED", "Choose an existing scheme.", {
            fieldErrors: [{ path: "body.gradingSchemeId", code: "invalid", message: "Unknown." }],
          }),
        );
      const p = schema.programmes;
      const [old] = await db.select().from(p).where(eq(p.id, programmeId)).for("update");
      if (old === undefined) return notFound();
      if (old.gradingSchemeId === schemeId) return ok(null);
      await db
        .update(p)
        .set({
          gradingSchemeId: schemeId,
          updatedAt: this.clock.now(),
          version: sql`${p.version} + 1`,
        })
        .where(eq(p.id, programmeId));
      await this.audit.record(db, actor, {
        action: "results.scheme.assigned",
        resourceType: "programme",
        resourceId: programmeId,
        metadata: { oldSchemeId: old.gradingSchemeId, schemeId },
      });
      return ok(null);
    });
    return result.ok ? ok(await this.must(schemeId)) : result;
  }

  /**
   * Locks a scheme as a result is graded with it, inside the caller's transaction (ticket 38).
   * Locking again changes nothing.
   */
  async lock(db: Database, id: string): Promise<void> {
    const g = schema.gradingSchemes;
    await db
      .update(g)
      .set({ lockedAt: this.clock.now() })
      .where(and(eq(g.id, id), isNull(g.lockedAt)));
  }

  private async must(id: string): Promise<GradingScheme> {
    const found = await this.get(id);
    if (found === null) throw new Error(`scheme ${id} vanished`);
    return found;
  }

  private async views(db: Database, rows: SchemeRow[]): Promise<GradingScheme[]> {
    const p = schema.programmes;
    const programmes =
      rows.length === 0
        ? []
        : await db
            .select({ id: p.id, code: p.code, name: p.name, schemeId: p.gradingSchemeId })
            .from(p)
            .where(
              inArray(
                p.gradingSchemeId,
                rows.map((r) => r.id),
              ),
            )
            .orderBy(asc(p.code));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as GradingScheme["kind"],
      bands: r.bands,
      classBands: r.classBands,
      minAwardCgpaX100: r.minAwardCgpaX100,
      maxPointsX100: r.maxPointsX100,
      passMarkX100: r.passMarkX100,
      repeatPolicy: r.repeatPolicy as GradingScheme["repeatPolicy"],
      goodStandingCgpaX100: r.goodStandingCgpaX100,
      probationCgpaX100: r.probationCgpaX100,
      supersedesId: r.supersedesId,
      lockedAt: r.lockedAt?.toISOString() ?? null,
      programmes: programmes
        .filter((x) => x.schemeId === r.id)
        .map((x) => ({ id: x.id, code: x.code, name: x.name })),
      version: r.version,
    }));
  }
}

/** Bands are kept from the top letter down. */
function sorted<T extends { minX100: number }>(bands: T[]): T[] {
  return [...bands].sort((a, b) => b.minX100 - a.minX100);
}
