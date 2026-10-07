import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule } from "@glim/modules/authorization";
import { Module } from "@nestjs/common";
import { AccountMailer } from "./account-mailer";
import { AuthService } from "./auth.service";
import { MeService } from "./me.service";
import { SessionService } from "./session.service";
import { SettingsService } from "./settings.service";
import { StaffAccountsService } from "./staff-accounts.service";
import { UserService } from "./user.service";

const services = [
  SettingsService,
  SessionService,
  AuthService,
  UserService,
  AccountMailer,
  StaffAccountsService,
  MeService,
];

@Module({ imports: [AuditModule, AuthorizationModule], providers: services, exports: services })
export class IdentityModule {}
