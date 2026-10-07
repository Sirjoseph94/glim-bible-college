import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { StaffAccountsService, type InvitedStaff } from "@glim/modules/identity";
import { unwrap } from "@glim/shared";
import type { INestApplicationContext } from "@nestjs/common";

/** Creates the first System Admin as the bootstrap CLI does; throws if one exists. */
export async function bootstrapSystemAdmin(
  app: INestApplicationContext,
  input: { email: string; displayName: string },
): Promise<InvitedStaff> {
  return unwrap(await app.get(StaffAccountsService).bootstrapSystemAdmin(input, SYSTEM_ACTOR));
}
