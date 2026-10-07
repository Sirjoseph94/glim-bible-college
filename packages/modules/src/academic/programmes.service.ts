import type { EnumValue } from "@glim/contracts";
import { Db, schema } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import {
  CLOCK,
  definedFields,
  domainError,
  err,
  ok,
  type Clock,
  type DomainResult,
  type Patch,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";

export type ProgrammeRow = typeof schema.programmes.$inferSelect;

export interface ProgrammeInput {
  code: string;
  name: string;
  awardType: EnumValue<"programmes.award_type">;
  durationSemesters: number;
  levels: number;
}

export type ProgrammeChange = Patch<
  Omit<ProgrammeInput, "code" | "awardType"> & { status: EnumValue<"programmes.status"> }
>;

const versionMismatch = () =>
  err(
    domainError("VERSION_MISMATCH", "Someone else changed this programme. Reload and try again."),
  );

/** Programmes: the Certificate and the Diploma (owner: academic, TRD §6.3). */
@Injectable()
export class ProgrammesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list(): Promise<ProgrammeRow[]> {
    return this.db.read.select().from(schema.programmes).orderBy(asc(schema.programmes.code));
  }

  async get(id: string): Promise<ProgrammeRow | null> {
    const [row] = await this.db.read
      .select()
      .from(schema.programmes)
      .where(eq(schema.programmes.id, id));
    return row ?? null;
  }

  async create(input: ProgrammeInput, actor: AuditActor): Promise<DomainResult<ProgrammeRow>> {
    return this.db.withTxResult(async ({ db }) => {
      const now = this.clock.now();
      const [row] = await db
        .insert(schema.programmes)
        .values({ ...input, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: schema.programmes.code })
        .returning();
      if (row === undefined)
        return err(domainError("CONFLICT", `A programme with code ${input.code} already exists.`));
      await this.audit.record(db, actor, {
        action: "academic.programme.created",
        resourceType: "programme",
        resourceId: row.id,
        metadata: { code: row.code },
      });
      return ok(row);
    });
  }

  async update(
    id: string,
    expectedVersion: number,
    change: ProgrammeChange,
    actor: AuditActor,
  ): Promise<DomainResult<ProgrammeRow>> {
    return this.db.withTxResult(async ({ db }) => {
      const p = schema.programmes;
      const fields = definedFields(change);
      const [row] = await db
        .update(p)
        .set({ ...fields, updatedAt: this.clock.now(), version: sql`${p.version} + 1` })
        .where(and(eq(p.id, id), eq(p.version, expectedVersion)))
        .returning();
      if (row === undefined) return versionMismatch();
      await this.audit.record(db, actor, {
        action: "academic.programme.updated",
        resourceType: "programme",
        resourceId: id,
        metadata: fields,
      });
      return ok(row);
    });
  }
}
