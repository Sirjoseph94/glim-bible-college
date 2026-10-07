import { audit, type QueryOf } from "@glim/contracts";
import { AuditService } from "@glim/modules/audit";
import { Controller, Inject } from "@nestjs/common";
import { Endpoint, Query } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

@Controller()
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Endpoint(audit.listAuditLogs)
  list(
    @Query(audit.listAuditLogs) query: QueryOf<typeof audit.listAuditLogs>,
  ): Promise<Reply<typeof audit.listAuditLogs>> {
    return this.audit.list(query);
  }
}
