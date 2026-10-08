import { AuditModule } from "@glim/modules/audit";
import { ContentModule } from "@glim/modules/content";
import { IdentityModule } from "@glim/modules/identity";
import { Module } from "@nestjs/common";
import { ImportsService } from "./imports.service";

const services = [ImportsService];

/** CSV imports of existing GLIM data (TRD §15.2). */
@Module({
  imports: [AuditModule, ContentModule, IdentityModule],
  providers: services,
  exports: services,
})
export class ImportsModule {}
