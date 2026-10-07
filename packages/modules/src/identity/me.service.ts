import type { Me } from "@glim/contracts";
import { RoleService } from "@glim/modules/authorization";
import { Inject, Injectable } from "@nestjs/common";
import type { ActiveSession } from "./session.service";
import { SettingsService } from "./settings.service";
import { UserService } from "./user.service";

/** The `GET /me` payload (§8.4): navigation data only; the server re-authorizes every action (INV-1). */
@Injectable()
export class MeService {
  constructor(
    @Inject(UserService) private readonly users: UserService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RoleService) private readonly roles: RoleService,
  ) {}

  /** Null when the session's user no longer exists. */
  async forSession(session: ActiveSession): Promise<Me | null> {
    const [user, institution, staff] = await Promise.all([
      this.users.findById(session.userId),
      this.settings.getInstitution(),
      this.roles.activeRoles(session.userId),
    ]);
    if (user === null) return null;
    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        // Viewers without their own zone see the institution's (§5.1).
        timezone: user.timezone ?? institution.timezone,
      },
      institution,
      roles: { staff, isLecturer: false, isStudent: false, isApplicant: false },
      csrfToken: session.csrfToken,
      featureFlags: {},
    };
  }
}
