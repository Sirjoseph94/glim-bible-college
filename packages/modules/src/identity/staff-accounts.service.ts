import type { StaffRole } from "@glim/contracts";
import { Db, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { RoleService } from "@glim/modules/authorization";
import { domainError, err, ok, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { AccountMailer } from "./account-mailer";
import { AuthService } from "./auth.service";
import { UserService, type Recipient, type UserProfile } from "./user.service";

export interface InvitedStaff {
  user: UserProfile;
  inviteLink: string;
  emailSent: boolean;
}

/** Creates staff accounts: the user, their roles and an invite, in one audited transaction (§8.1, INV-11). */
@Injectable()
export class StaffAccountsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(UserService) private readonly users: UserService,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AccountMailer) private readonly mail: AccountMailer,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async inviteStaff(
    input: Recipient & { roles: StaffRole[] },
    actor: AuditActor,
  ): Promise<DomainResult<InvitedStaff>> {
    return this.sendInvite(
      await this.db.withTxResult(({ db }) => this.createInvited(db, input, actor)),
    );
  }

  /**
   * Creates the first System Admin. Refused once any System Admin exists; a transaction-scoped
   * advisory lock serialises concurrent bootstraps, so only one can pass the check.
   */
  async bootstrapSystemAdmin(
    input: Recipient,
    actor: AuditActor,
  ): Promise<DomainResult<InvitedStaff>> {
    const created = await this.db.withTxResult(async ({ db }) => {
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('glim.bootstrap-system-admin'))`);
      if (await this.roles.anyoneHolds("SYSTEM_ADMIN", db)) {
        return err(
          domainError(
            "CONFLICT",
            "This installation already has a System Admin; invite further staff from the app.",
          ),
        );
      }
      return this.createInvited(db, { ...input, roles: ["SYSTEM_ADMIN"] }, actor);
    });
    return this.sendInvite(created);
  }

  /**
   * Creates an invited account inside the caller's transaction, for modules that create a
   * profile with it (e.g. a Lecturer). Send the invite with `sendInvite` once that commits.
   */
  async createInvited(
    db: Database,
    input: Recipient & { roles: StaffRole[] },
    actor: AuditActor,
  ): Promise<DomainResult<{ user: UserProfile; token: string }>> {
    const user = await this.users.createInvitedUser(db, input);
    if (!user.ok) return user;
    // Staff and Lecturers can refer applicants (§10.6).
    await this.users.ensureReferralCode(db, user.value.id);
    await this.audit.record(db, actor, {
      action: "identity.user.invited",
      resourceType: "user",
      resourceId: user.value.id,
      metadata: { roles: input.roles },
    });
    for (const role of input.roles) {
      await this.roles.grant(db, actor, {
        userId: user.value.id,
        role,
        reason: "Granted when invited",
      });
    }
    return ok({
      user: user.value,
      token: await this.auth.issueInvite(db, user.value.id, actor.userId),
    });
  }

  /** Emails the invite once the account is committed (tokens are never stored in plaintext). */
  async sendInvite(
    created: DomainResult<{ user: UserProfile; token: string }>,
  ): Promise<DomainResult<InvitedStaff>> {
    if (!created.ok) return created;
    const { user, token } = created.value;
    const emailSent = await this.mail.sendInvite(user, token);
    return ok({ user, inviteLink: this.mail.inviteLink(token), emailSent });
  }
}
