import type { StaffRole } from "@glim/contracts";
import { Db } from "@glim/db";
import { RoleService } from "@glim/modules/authorization";
import { Inject, Injectable } from "@nestjs/common";
import { AccountMailer } from "./account-mailer";
import { AuthService } from "./auth.service";
import { UserService, type UserProfile } from "./user.service";

export interface InvitedStaff {
  user: UserProfile;
  inviteLink: string;
  emailSent: boolean;
}

/** Creates staff accounts: the user, their roles and an invite, in one transaction (§8.1, §8.2). */
@Injectable()
export class StaffAccountsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(UserService) private readonly users: UserService,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AccountMailer) private readonly mail: AccountMailer,
  ) {}

  async inviteStaff(input: {
    email: string;
    displayName: string;
    roles: StaffRole[];
    invitedBy: string | null;
  }): Promise<InvitedStaff> {
    const { user, token } = await this.db.withTx(async ({ db }) => {
      const created = await this.users.createInvitedUser(db, input);
      for (const role of input.roles) {
        await this.roles.grant(db, { userId: created.id, role, grantedBy: input.invitedBy });
      }
      return { user: created, token: await this.auth.issueInvite(db, created.id, input.invitedBy) };
    });
    const emailSent = await this.mail.sendInvite(user, token);
    return { user, inviteLink: this.mail.inviteLink(token), emailSent };
  }
}
