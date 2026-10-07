import type { Me } from "@glim/contracts";
import { RoleService } from "@glim/modules/authorization";
import { SettingsService, UserService, type ActiveSession } from "@glim/modules/identity";
import { AppError } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";

/** Builds the `GET /me` payload (§8.4) from the identity and authorization modules. */
@Injectable()
export class MeAssembler {
  constructor(
    @Inject(UserService) private readonly users: UserService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RoleService) private readonly roles: RoleService,
  ) {}

  async build(session: ActiveSession): Promise<Me> {
    const [user, institution, staff] = await Promise.all([
      this.users.findById(session.userId),
      this.settings.getInstitution(),
      this.roles.activeRoles(session.userId),
    ]);
    if (user === null) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        timezone: user.timezone ?? institution.timezone,
      },
      institution,
      roles: { staff, isLecturer: false, isStudent: false, isApplicant: false },
      csrfToken: session.csrfToken,
      featureFlags: {},
    };
  }
}
