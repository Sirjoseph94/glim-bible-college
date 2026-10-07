import { AuditModule } from "@glim/modules/audit";
import { Module } from "@nestjs/common";
import { AuthorizationService } from "./authorization.service";
import { RoleService } from "./role.service";

@Module({
  imports: [AuditModule],
  providers: [RoleService, AuthorizationService],
  exports: [RoleService, AuthorizationService],
})
export class AuthorizationModule {}
