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

export type RoomRow = typeof schema.rooms.$inferSelect;

/** Rooms where the in-person part of a Class Meeting happens; capacity is informational (C-35). */
@Injectable()
export class RoomsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list(): Promise<RoomRow[]> {
    return this.db.read.select().from(schema.rooms).orderBy(asc(schema.rooms.code));
  }

  async get(id: string): Promise<RoomRow | null> {
    const [row] = await this.db.read.select().from(schema.rooms).where(eq(schema.rooms.id, id));
    return row ?? null;
  }

  create(
    input: { code: string; name: string; capacity: number | null },
    actor: AuditActor,
  ): Promise<DomainResult<RoomRow>> {
    return this.db.withTxResult(async ({ db }) => {
      const now = this.clock.now();
      const [row] = await db
        .insert(schema.rooms)
        .values({ ...input, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: schema.rooms.code })
        .returning();
      if (row === undefined)
        return err(domainError("CONFLICT", `A Room with code ${input.code} already exists.`));
      await this.audit.record(db, actor, {
        action: "academic.room.created",
        resourceType: "room",
        resourceId: row.id,
        metadata: { code: row.code },
      });
      return ok(row);
    });
  }

  update(
    id: string,
    expectedVersion: number,
    change: Patch<{ name: string; capacity: number | null; status: EnumValue<"rooms.status"> }>,
    actor: AuditActor,
  ): Promise<DomainResult<RoomRow>> {
    return this.db.withTxResult(async ({ db }) => {
      const r = schema.rooms;
      const fields = definedFields(change);
      const [row] = await db
        .update(r)
        .set({ ...fields, updatedAt: this.clock.now(), version: sql`${r.version} + 1` })
        .where(and(eq(r.id, id), eq(r.version, expectedVersion)))
        .returning();
      if (row === undefined)
        return err(
          domainError("VERSION_MISMATCH", "Someone else changed this Room. Reload and try again."),
        );
      await this.audit.record(db, actor, {
        action: "academic.room.updated",
        resourceType: "room",
        resourceId: id,
        metadata: fields,
      });
      return ok(row);
    });
  }
}
