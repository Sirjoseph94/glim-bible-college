import type { EnumValue } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { CLOCK, decodeCursor, toPage, type Clock, type Page } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";

/** Who did it and from where; carried from the request into every audit row. */
export interface AuditActor {
  userId: string | null;
  type: EnumValue<"audit_logs.actor_type">;
  requestId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: EnumValue<"audit_logs.outcome">;
  /** Never put sensitive applicant answers here (INV-15). */
  metadata?: Record<string, unknown>;
}

export interface AuditLogItem {
  id: string;
  createdAt: Date;
  actorUserId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
  requestId: string | null;
}

export const SYSTEM_ACTOR: AuditActor = { userId: null, type: "SYSTEM" };

/** Append-only audit trail, written in the same transaction as the audited change (INV-11). */
@Injectable()
export class AuditService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async record(db: Database, actor: AuditActor, entry: AuditEntry): Promise<void> {
    await db.insert(schema.auditLogs).values({
      createdAt: this.clock.now(),
      actorUserId: actor.userId,
      actorType: actor.type,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      outcome: entry.outcome ?? "SUCCESS",
      metadata: entry.metadata ?? {},
      requestId: actor.requestId ?? null,
      ip: actor.ip ?? null,
      userAgent: actor.userAgent?.slice(0, 512) ?? null,
    });
  }

  /** Newest first, filtered and cursor-paginated (§5.4). */
  async list(filter: {
    resourceType?: string | undefined;
    resourceId?: string | undefined;
    actorUserId?: string | undefined;
    limit: number;
    cursor?: string | undefined;
  }): Promise<Page<AuditLogItem>> {
    const t = schema.auditLogs;
    const conditions: SQL[] = [];
    if (filter.resourceType !== undefined) conditions.push(eq(t.resourceType, filter.resourceType));
    if (filter.resourceId !== undefined) conditions.push(eq(t.resourceId, filter.resourceId));
    if (filter.actorUserId !== undefined) conditions.push(eq(t.actorUserId, filter.actorUserId));
    if (filter.cursor !== undefined) {
      const at = decodeCursor(filter.cursor);
      const createdAt = new Date(at.sortKey);
      const after = or(
        lt(t.createdAt, createdAt),
        and(eq(t.createdAt, createdAt), lt(t.id, at.id)),
      );
      if (after) conditions.push(after);
    }
    const rows = await this.db.read
      .select()
      .from(t)
      .where(and(...conditions))
      .orderBy(desc(t.createdAt), desc(t.id))
      .limit(filter.limit + 1);
    return toPage(
      rows.map((r) => ({ ...r, metadata: r.metadata as Record<string, unknown> })),
      filter.limit,
      (r) => r.createdAt.toISOString(),
    );
  }
}
