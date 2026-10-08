import type { StaffRole } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import {
  AuthorizationService,
  RoleService,
  type RoleAssignment,
} from "@glim/modules/authorization";
import {
  CLOCK,
  decodeCursor,
  domainError,
  err,
  isUuid,
  ok,
  toPage,
  type Clock,
  type DomainResult,
  type Page,
} from "@glim/shared";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { and, asc, eq, gt, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { AccountMailer } from "./account-mailer";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { toProfile, UserService, type UserProfile, type UserStatus } from "./user.service";

export interface UserListItem {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  roles: StaffRole[];
  lastLoginAt: Date | null;
}

export interface UserDetail extends UserProfile {
  lastLoginAt: Date | null;
  createdAt: Date;
  version: number;
  roles: RoleAssignment[];
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const lastAdmin = () =>
  err(
    domainError(
      "CONFLICT",
      "This is the last active System Admin. Make someone else a System Admin first.",
    ),
  );

/** System Admin user management (§16 Users, §8.2). Every change is audited (INV-11). */
@Injectable()
export class UserAdminService implements OnModuleInit {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AccountMailer) private readonly mail: AccountMailer,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(UserService) private readonly users: UserService,
  ) {}

  /** Identity owns users, so it tells the AuthorizationService whether one exists (§7.2). */
  onModuleInit(): void {
    this.authorization.registerLoader("user", async (id) => {
      if (!isUuid(id)) return null;
      const [row] = await this.db.read
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, id));
      return row === undefined ? null : { ownerUserId: row.id };
    });
  }

  async list(filter: {
    status?: UserStatus | undefined;
    q?: string | undefined;
    limit: number;
    cursor?: string | undefined;
  }): Promise<Page<UserListItem>> {
    const u = schema.users;
    const conditions: SQL[] = [];
    if (filter.status !== undefined) conditions.push(eq(u.status, filter.status));
    if (filter.q !== undefined) {
      const pattern = `%${filter.q.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const match = or(ilike(u.email, pattern), ilike(u.displayName, pattern));
      if (match) conditions.push(match);
    }
    if (filter.cursor !== undefined) {
      const at = decodeCursor(filter.cursor);
      const after = or(gt(u.email, at.sortKey), and(eq(u.email, at.sortKey), gt(u.id, at.id)));
      if (after) conditions.push(after);
    }
    const rows = await this.db.read
      .select()
      .from(u)
      .where(and(...conditions))
      .orderBy(asc(u.email), asc(u.id))
      .limit(filter.limit + 1);
    const pageRows = toPage(rows, filter.limit, (r) => r.email);
    const roles = await this.roles.activeRolesByUser(pageRows.items.map((r) => r.id));
    return {
      items: pageRows.items.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.displayName,
        status: r.status as UserStatus,
        roles: roles.get(r.id) ?? [],
        lastLoginAt: r.lastLoginAt,
      })),
      nextCursor: pageRows.nextCursor,
    };
  }

  async get(id: string): Promise<UserDetail | null> {
    const [row] = await this.db.read.select().from(schema.users).where(eq(schema.users.id, id));
    if (row === undefined) return null;
    return {
      ...toProfile(row),
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      version: row.version,
      roles: await this.roles.activeAssignments(id),
    };
  }

  /** Renames, suspends or reactivates a user (optimistic concurrency by version, §5.4). */
  async update(
    id: string,
    expectedVersion: number,
    change: {
      displayName?: string | undefined;
      status?: "ACTIVE" | "SUSPENDED" | undefined;
      reason?: string | undefined;
    },
    actor: AuditActor,
  ): Promise<DomainResult<UserDetail>> {
    const result = await this.db.withTxResult(async ({ db }) => {
      await this.lockSystemAdmins(db);
      const [current] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, id))
        .for("update");
      if (current === undefined) return notFound();
      if (current.version !== expectedVersion) {
        return err(
          domainError("VERSION_MISMATCH", "Someone else changed this user. Reload and try again."),
        );
      }
      if (change.status !== undefined && change.status !== current.status) {
        const allowed =
          (current.status === "ACTIVE" && change.status === "SUSPENDED") ||
          (current.status === "SUSPENDED" && change.status === "ACTIVE");
        if (!allowed) {
          return err(
            domainError(
              "CONFLICT",
              `A ${current.status.toLowerCase()} user can't be made ${change.status.toLowerCase()}.`,
            ),
          );
        }
        if (change.status === "SUSPENDED" && (await this.isLastActiveSystemAdmin(db, id)))
          return lastAdmin();
      }
      await db
        .update(schema.users)
        .set({
          ...(change.displayName === undefined ? {} : { displayName: change.displayName }),
          ...(change.status === undefined ? {} : { status: change.status }),
          updatedAt: this.clock.now(),
          version: sql`${schema.users.version} + 1`,
        })
        .where(eq(schema.users.id, id));
      // Suspending ends every session immediately (§8.2).
      if (change.status === "SUSPENDED") await this.sessions.revokeAllForUser(db, id);
      await this.audit.record(db, actor, {
        action: "identity.user.updated",
        resourceType: "user",
        resourceId: id,
        metadata: {
          ...(change.displayName === undefined
            ? {}
            : { displayName: { from: current.displayName, to: change.displayName } }),
          ...(change.status === undefined
            ? {}
            : { status: { from: current.status, to: change.status } }),
          ...(change.reason === undefined ? {} : { reason: change.reason }),
        },
      });
      return ok(null);
    });
    return this.detailAfter(result, id);
  }

  /** Deactivation is permanent: no sign-in, every session ends, data is kept (§8.2). */
  async deactivate(
    id: string,
    reason: string,
    actor: AuditActor,
  ): Promise<DomainResult<UserDetail>> {
    const result = await this.db.withTxResult(async ({ db }) => {
      await this.lockSystemAdmins(db);
      const [current] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, id))
        .for("update");
      if (current === undefined) return notFound();
      if (current.status === "DEACTIVATED")
        return err(domainError("CONFLICT", "This user is already deactivated."));
      if (await this.isLastActiveSystemAdmin(db, id)) return lastAdmin();
      await db
        .update(schema.users)
        .set({
          status: "DEACTIVATED",
          updatedAt: this.clock.now(),
          version: sql`${schema.users.version} + 1`,
        })
        .where(eq(schema.users.id, id));
      await this.sessions.revokeAllForUser(db, id);
      await this.audit.record(db, actor, {
        action: "identity.user.deactivated",
        resourceType: "user",
        resourceId: id,
        metadata: { from: current.status, reason },
      });
      return ok(null);
    });
    return this.detailAfter(result, id);
  }

  /** A fresh invite for someone who hasn't accepted theirs; the old link stops working. */
  async resendInvite(id: string, actor: AuditActor): Promise<DomainResult<{ emailSent: boolean }>> {
    const issued = await this.db.withTxResult(async ({ db }) => {
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
      if (user === undefined) return notFound();
      if (user.status !== "INVITED")
        return err(domainError("CONFLICT", "This user has already accepted their invite."));
      const token = await this.auth.issueInvite(db, id, actor.userId);
      await this.audit.record(db, actor, {
        action: "identity.user.invite-resent",
        resourceType: "user",
        resourceId: id,
      });
      return ok({ user: toProfile(user), token });
    });
    if (!issued.ok) return issued;
    return ok({ emailSent: await this.mail.sendInvite(issued.value.user, issued.value.token) });
  }

  async assignRole(
    userId: string,
    role: StaffRole,
    reason: string,
    actor: AuditActor,
  ): Promise<DomainResult<RoleAssignment>> {
    return this.db.withTxResult(async ({ db }) => {
      const [user] = await db
        .select({ status: schema.users.status })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      if (user === undefined) return notFound();
      if (user.status === "DEACTIVATED")
        return err(domainError("CONFLICT", "A deactivated user can't be given a role."));
      // Staff can refer applicants (§10.6).
      await this.users.ensureReferralCode(db, userId);
      return this.roles.grant(db, actor, { userId, role, reason });
    });
  }

  async revokeRole(
    userId: string,
    assignmentId: string,
    reason: string,
    actor: AuditActor,
  ): Promise<DomainResult<RoleAssignment>> {
    return this.db.withTxResult(async ({ db }) => {
      await this.lockSystemAdmins(db);
      const ra = schema.roleAssignments;
      const [assignment] = await db
        .select({ role: ra.role })
        .from(ra)
        .where(and(eq(ra.id, assignmentId), eq(ra.userId, userId), isNull(ra.revokedAt)));
      if (assignment?.role === "SYSTEM_ADMIN" && (await this.isLastActiveSystemAdmin(db, userId)))
        return lastAdmin();
      return this.roles.revoke(db, actor, { userId, assignmentId, reason });
    });
  }

  private async detailAfter(
    result: DomainResult<null>,
    id: string,
  ): Promise<DomainResult<UserDetail>> {
    if (!result.ok) return result;
    const detail = await this.get(id);
    return detail === null ? notFound() : ok(detail);
  }

  /** Serialises changes that could remove the last System Admin. */
  private async lockSystemAdmins(db: Database): Promise<void> {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('glim.system-admins'))`);
  }

  /** True when `userId` is an active System Admin and no other active user is one. */
  private async isLastActiveSystemAdmin(db: Database, userId: string): Promise<boolean> {
    const ra = schema.roleAssignments;
    const u = schema.users;
    const holders = await db
      .select({ userId: ra.userId })
      .from(ra)
      .innerJoin(u, eq(u.id, ra.userId))
      .where(and(eq(ra.role, "SYSTEM_ADMIN"), isNull(ra.revokedAt), eq(u.status, "ACTIVE")));
    return holders.some((h) => h.userId === userId) && !holders.some((h) => h.userId !== userId);
  }
}
