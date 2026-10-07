import { users, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import { StaffAccountsService, UserAdminService } from "@glim/modules/identity";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params, Query } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

type IdParams = ParamsOf<typeof users.getUser>;

@Controller()
export class UsersController {
  constructor(
    @Inject(UserAdminService) private readonly admin: UserAdminService,
    @Inject(StaffAccountsService) private readonly staff: StaffAccountsService,
  ) {}

  @Endpoint(users.listUsers)
  list(
    @Query(users.listUsers) query: QueryOf<typeof users.listUsers>,
  ): Promise<Reply<typeof users.listUsers>> {
    return this.admin.list(query);
  }

  @Endpoint(users.inviteUser)
  async invite(
    @Body(users.inviteUser) body: BodyOf<typeof users.inviteUser>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof users.inviteUser>> {
    const invited = unwrap(await this.staff.inviteStaff(body, actor));
    return { user: await this.detail(invited.user.id), emailSent: invited.emailSent };
  }

  @Endpoint(users.getUser)
  get(@Params(users.getUser) params: IdParams): Promise<Reply<typeof users.getUser>> {
    return this.detail(params.id);
  }

  @Endpoint(users.updateUser)
  async update(
    @Params(users.updateUser) params: IdParams,
    @IfMatch() version: number,
    @Body(users.updateUser) body: BodyOf<typeof users.updateUser>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof users.updateUser>> {
    return unwrap(await this.admin.update(params.id, version, body, actor));
  }

  @Endpoint(users.deactivateUser)
  async deactivate(
    @Params(users.deactivateUser) params: IdParams,
    @Body(users.deactivateUser) body: BodyOf<typeof users.deactivateUser>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof users.deactivateUser>> {
    return unwrap(await this.admin.deactivate(params.id, body.reason, actor));
  }

  @Endpoint(users.resendInvite)
  async resendInvite(
    @Params(users.resendInvite) params: IdParams,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof users.resendInvite>> {
    return unwrap(await this.admin.resendInvite(params.id, actor));
  }

  @Endpoint(users.assignRole)
  async assignRole(
    @Params(users.assignRole) params: IdParams,
    @Body(users.assignRole) body: BodyOf<typeof users.assignRole>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof users.assignRole>> {
    return unwrap(await this.admin.assignRole(params.id, body.role, body.reason, actor));
  }

  @Endpoint(users.revokeRole)
  async revokeRole(
    @Params(users.revokeRole) params: ParamsOf<typeof users.revokeRole>,
    @Body(users.revokeRole) body: BodyOf<typeof users.revokeRole>,
    @Actor() actor: AuditActor,
  ): Promise<void> {
    unwrap(await this.admin.revokeRole(params.id, params.assignmentId, body.reason, actor));
  }

  private async detail(id: string) {
    const user = await this.admin.get(id);
    if (user === null) throw new AppError("NOT_FOUND", "Not found.");
    return user;
  }
}
