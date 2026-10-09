import { AuditModule } from "@glim/modules/audit";
import { Module } from "@nestjs/common";
import { GradingSchemesService } from "./grading-schemes.service";

/** Results (TRD §14.3–14.5): grading schemes and the results arithmetic. */
@Module({
  imports: [AuditModule],
  providers: [GradingSchemesService],
  exports: [GradingSchemesService],
})
export class ResultsModule {}
