import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditQuerySchema, type AuditPage, type AuditQuery } from "@devguard/shared";
import { API_V1 } from "../../common/api-version.js";
import { Roles } from "../../common/auth/decorators.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { AuditService } from "./audit.service.js";

/** Read only: there is deliberately no route that creates, edits or deletes an audit entry. */
@ApiTags("audit")
@Roles("security_admin")
@Controller(`${API_V1}/audit`)
export class AuditController {
  public constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: "Administrative audit history, newest first (admin). Append-only." })
  public list(@Query(new ZodValidationPipe(AuditQuerySchema)) query: AuditQuery): Promise<AuditPage> {
    return this.audit.list(query);
  }
}
