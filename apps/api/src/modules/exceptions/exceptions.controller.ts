import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  ExceptionDecisionInputSchema,
  ExceptionQuerySchema,
  ExceptionRejectionInputSchema,
  ExceptionRequestInputSchema,
  type ExceptionDecisionInput,
  type ExceptionEntry,
  type ExceptionPage,
  type ExceptionQuery,
  type ExceptionRejectionInput,
  type ExceptionRequestInput,
} from "@devguard/shared";
import { API_V1 } from "../../common/api-version.js";
import { CurrentUser, Roles } from "../../common/auth/decorators.js";
import type { UserPrincipal } from "../../common/auth/principals.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ExceptionsService } from "./exceptions.service.js";

const idPipe = new ZodValidationPipe(z.uuid());
const scopeOf = (user: UserPrincipal): { userId: string; isAdmin: boolean } => ({ userId: user.id, isAdmin: user.isAdmin });

/** Dashboard routes (user session). Deciding is admin-only (ADR-014) and never by the requester (ADR-007). */
@ApiTags("exceptions")
@Controller(`${API_V1}/exceptions`)
export class ExceptionsController {
  public constructor(@Inject(ExceptionsService) private readonly exceptions: ExceptionsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Request an exception for one project and one destination (an employee assigned to the project)" })
  public request(@CurrentUser() user: UserPrincipal, @Body(new ZodValidationPipe(ExceptionRequestInputSchema)) body: ExceptionRequestInput): Promise<ExceptionEntry> {
    return this.exceptions.request({ userId: user.id, deviceId: null }, body);
  }

  @Get()
  @ApiOperation({ summary: "List requests: all for admins, own for everyone else. `expired` is derived from the approval's expiry." })
  public list(@CurrentUser() user: UserPrincipal, @Query(new ZodValidationPipe(ExceptionQuerySchema)) query: ExceptionQuery): Promise<ExceptionPage> {
    return this.exceptions.list(scopeOf(user), query);
  }

  @Get(":id")
  @ApiOperation({ summary: "One request with its decision history (admin or requester)" })
  public get(@CurrentUser() user: UserPrincipal, @Param("id", idPipe) id: string): Promise<ExceptionEntry> {
    return this.exceptions.get(scopeOf(user), id);
  }

  @Post(":id/approve")
  @Roles("security_admin")
  @HttpCode(200)
  @ApiOperation({ summary: "Approve a pending request until `expiresAt` (future, within the server cap). Not your own request." })
  public approve(@CurrentUser() actor: UserPrincipal, @Param("id", idPipe) id: string, @Body(new ZodValidationPipe(ExceptionDecisionInputSchema)) body: ExceptionDecisionInput): Promise<ExceptionEntry> {
    return this.exceptions.approve(actor, id, body);
  }

  @Post(":id/reject")
  @Roles("security_admin")
  @HttpCode(200)
  @ApiOperation({ summary: "Reject a pending request with a reason. Not your own request." })
  public reject(@CurrentUser() actor: UserPrincipal, @Param("id", idPipe) id: string, @Body(new ZodValidationPipe(ExceptionRejectionInputSchema)) body: ExceptionRejectionInput): Promise<ExceptionEntry> {
    return this.exceptions.reject(actor, id, body);
  }

  @Post(":id/revoke")
  @Roles("security_admin")
  @HttpCode(200)
  @ApiOperation({ summary: "Withdraw an approval that is still in force (admin). Takes effect at the next validation." })
  public revoke(@CurrentUser() actor: UserPrincipal, @Param("id", idPipe) id: string, @Body(new ZodValidationPipe(ExceptionRejectionInputSchema)) body: ExceptionRejectionInput): Promise<ExceptionEntry> {
    return this.exceptions.revoke(actor, id, body);
  }
}
