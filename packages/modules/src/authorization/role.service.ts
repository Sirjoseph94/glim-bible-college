import type { StaffRole } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

export interface RoleAssignment {
  id: string;
  role: StaffRole;
  grantedAt: Date;
  grantedBy: string | null;
  reason: string | null;
}

/** Staff role assignments (owner: authorization, §6.2, §7.1). Every change is audited (INV-11). */
@Injectable()
export class RoleService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Grants a role inside the caller's transaction; granting a role already held is a conflict. */
  async grant(
    db: Database,
    actor: AuditActor,
    input: { userId: string; role: StaffRole; reason: string },
  ): Promise<DomainResult<RoleAssignment>> {
    const [row] = await db
      .insert(schema.roleAssignments)
      .values({
        userId: input.userId,
        role: input.role,
        grantedBy: actor.userId,
        reason: input.reason,
        createdAt: this.clock.now(),
      })
      .onConflictDoNothing()
      .returning();
    if (row === undefined) return err(domainError("CONFLICT", "The user already has this role."));
    await this.audit.record(db, actor, {
      action: "authorization.role.granted",
      resourceType: "user",
      resourceId: input.userId,
      metadata: { role: input.role, assignmentId: row.id, reason: input.reason },
    });
    return ok(toAssignment(row));
  }

  /** Revokes one active assignment of a user, with a reason, inside the caller's transaction. */
  async revoke(
    db: Database,
    actor: AuditActor,
    input: { userId: string; assignmentId: string; reason: string },
  ): Promise<DomainResult<RoleAssignment>> {
    const t = schema.roleAssignments;
    const [row] = await db
      .update(t)
      .set({ revokedAt: this.clock.now() })
      .where(and(eq(t.id, input.assignmentId), eq(t.userId, input.userId), isNull(t.revokedAt)))
      .returning();
    if (row === undefined)
      return err(
        domainError("NOT_FOUND", "That role assignment doesn't exist or is already revoked."),
      );
    await this.audit.record(db, actor, {
      action: "authorization.role.revoked",
      resourceType: "user",
      resourceId: input.userId,
      metadata: { role: row.role, assignmentId: row.id, reason: input.reason },
    });
    return ok(toAssignment(row));
  }

  async activeAssignments(userId: string): Promise<RoleAssignment[]> {
    const t = schema.roleAssignments;
    const rows = await this.db.read
      .select()
      .from(t)
      .where(and(eq(t.userId, userId), isNull(t.revokedAt)))
      .orderBy(asc(t.role));
    return rows.map(toAssignment);
  }

  async activeRoles(userId: string): Promise<StaffRole[]> {
    return (await this.activeAssignments(userId)).map((a) => a.role);
  }

  /** Active roles for many users at once (list screens). */
  async activeRolesByUser(userIds: string[]): Promise<Map<string, StaffRole[]>> {
    const out = new Map<string, StaffRole[]>();
    if (userIds.length === 0) return out;
    const t = schema.roleAssignments;
    const rows = await this.db.read
      .select({ userId: t.userId, role: t.role })
      .from(t)
      .where(and(inArray(t.userId, userIds), isNull(t.revokedAt)))
      .orderBy(asc(t.role));
    for (const row of rows) {
      out.set(row.userId, [...(out.get(row.userId) ?? []), row.role as StaffRole]);
    }
    return out;
  }

  async anyoneHolds(role: StaffRole, db: Database = this.db.read): Promise<boolean> {
    const t = schema.roleAssignments;
    const [row] = await db
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.role, role), isNull(t.revokedAt)))
      .limit(1);
    return row !== undefined;
  }
}

function toAssignment(row: typeof schema.roleAssignments.$inferSelect): RoleAssignment {
  return {
    id: row.id,
    role: row.role as StaffRole,
    grantedAt: row.createdAt,
    grantedBy: row.grantedBy,
    reason: row.reason,
  };
}
