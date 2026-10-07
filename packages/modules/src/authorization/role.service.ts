import type { StaffRole } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

/** Staff role assignments (owner: authorization, §6.2, §7.1). */
@Injectable()
export class RoleService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async grant(
    db: Database,
    input: { userId: string; role: StaffRole; grantedBy: string | null },
  ): Promise<void> {
    await db
      .insert(schema.roleAssignments)
      .values({ userId: input.userId, role: input.role, grantedBy: input.grantedBy })
      .onConflictDoNothing();
  }

  async activeRoles(userId: string): Promise<StaffRole[]> {
    const rows = await this.db.read
      .select({ role: schema.roleAssignments.role })
      .from(schema.roleAssignments)
      .where(
        and(eq(schema.roleAssignments.userId, userId), isNull(schema.roleAssignments.revokedAt)),
      );
    return rows.map((r) => r.role as StaffRole).sort();
  }

  async anyoneHolds(role: StaffRole): Promise<boolean> {
    const [row] = await this.db.read
      .select({ id: schema.roleAssignments.id })
      .from(schema.roleAssignments)
      .where(and(eq(schema.roleAssignments.role, role), isNull(schema.roleAssignments.revokedAt)))
      .limit(1);
    return row !== undefined;
  }
}
