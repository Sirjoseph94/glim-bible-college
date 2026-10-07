import type { EnumValue } from "@glim/contracts";
import { Db, schema } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import {
  CLOCK,
  decodeCursor,
  domainError,
  err,
  ok,
  toPage,
  type Clock,
  type DomainResult,
  type Page,
  type Patch,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, ilike, or, sql, type SQL } from "drizzle-orm";

export type CourseRow = typeof schema.courses.$inferSelect;

export interface CourseInput {
  code: string;
  title: string;
  description: string | null;
  credits: string;
}

export type CourseChange = Patch<
  Omit<CourseInput, "code"> & { status: EnumValue<"courses.status"> }
>;

/** The course catalogue (owner: academic, TRD §6.3). */
@Injectable()
export class CoursesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(filter: {
    q?: string | undefined;
    status?: string | undefined;
    limit: number;
    cursor?: string | undefined;
  }): Promise<Page<CourseRow>> {
    const c = schema.courses;
    const conditions: SQL[] = [];
    if (filter.status !== undefined) conditions.push(eq(c.status, filter.status));
    if (filter.q !== undefined) {
      const pattern = `%${filter.q.replaceAll(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const match = or(ilike(c.code, pattern), ilike(c.title, pattern));
      if (match) conditions.push(match);
    }
    if (filter.cursor !== undefined) {
      const at = decodeCursor(filter.cursor);
      const after = or(gt(c.code, at.sortKey), and(eq(c.code, at.sortKey), gt(c.id, at.id)));
      if (after) conditions.push(after);
    }
    const rows = await this.db.read
      .select()
      .from(c)
      .where(and(...conditions))
      .orderBy(asc(c.code), asc(c.id))
      .limit(filter.limit + 1);
    return toPage(rows, filter.limit, (r) => r.code);
  }

  async get(id: string): Promise<CourseRow | null> {
    const [row] = await this.db.read.select().from(schema.courses).where(eq(schema.courses.id, id));
    return row ?? null;
  }

  async create(input: CourseInput, actor: AuditActor): Promise<DomainResult<CourseRow>> {
    return this.db.withTxResult(async ({ db }) => {
      const now = this.clock.now();
      const [row] = await db
        .insert(schema.courses)
        .values({ ...input, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: schema.courses.code })
        .returning();
      if (row === undefined)
        return err(domainError("CONFLICT", `A course with code ${input.code} already exists.`));
      await this.audit.record(db, actor, {
        action: "academic.course.created",
        resourceType: "course",
        resourceId: row.id,
        metadata: { code: row.code, credits: row.credits },
      });
      return ok(row);
    });
  }

  async update(
    id: string,
    expectedVersion: number,
    change: CourseChange,
    actor: AuditActor,
  ): Promise<DomainResult<CourseRow>> {
    return this.db.withTxResult(async ({ db }) => {
      const c = schema.courses;
      const fields = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined));
      const [row] = await db
        .update(c)
        .set({ ...fields, updatedAt: this.clock.now(), version: sql`${c.version} + 1` })
        .where(and(eq(c.id, id), eq(c.version, expectedVersion)))
        .returning();
      if (row === undefined)
        return err(
          domainError(
            "VERSION_MISMATCH",
            "Someone else changed this course. Reload and try again.",
          ),
        );
      await this.audit.record(db, actor, {
        action: "academic.course.updated",
        resourceType: "course",
        resourceId: id,
        metadata: fields,
      });
      return ok(row);
    });
  }
}
