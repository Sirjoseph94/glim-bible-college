import { RoleService } from "@glim/modules/authorization";
import { StaffAccountsService, type InvitedStaff } from "@glim/modules/identity";
import type { INestApplicationContext } from "@nestjs/common";

/**
 * Creates the first System Admin and emails their invite (ticket 03). Refuses once any System
 * Admin exists; later staff are invited from the app.
 */
export async function bootstrapSystemAdmin(
  app: INestApplicationContext,
  input: { email: string; displayName: string },
): Promise<InvitedStaff> {
  if (await app.get(RoleService).anyoneHolds("SYSTEM_ADMIN")) {
    throw new Error(
      "This installation already has a System Admin; invite further staff from the app.",
    );
  }
  return app
    .get(StaffAccountsService)
    .inviteStaff({ ...input, roles: ["SYSTEM_ADMIN"], invitedBy: null });
}
