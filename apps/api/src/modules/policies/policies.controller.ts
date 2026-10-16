import { Body, Controller, Get, Inject, Param, Put } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PolicyUpdateRequestSchema, type PolicyUpdateRequest, type PolicyVersionEntry, type ProjectPolicy } from "@devguard/shared";
import { API_V1 } from "../../common/api-version.js";
import { CurrentUser, Roles } from "../../common/auth/decorators.js";
import type { UserPrincipal } from "../../common/auth/principals.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PoliciesService } from "./policies.service.js";

const idPipe = new ZodValidationPipe(z.uuid());

@ApiTags("policies")
@Roles("security_admin")
@Controller(`${API_V1}/projects/:projectId/policy`)
export class PoliciesController {
  public constructor(@Inject(PoliciesService) private readonly policies: PoliciesService) {}

  @Get()
  @ApiOperation({ summary: "Current policy of a project (admin)" })
  public get(@Param("projectId", idPipe) projectId: string): Promise<ProjectPolicy> {
    return this.policies.getPolicy(projectId);
  }

  @Put()
  @ApiOperation({ summary: "Create the next policy version (admin). 409 if baseVersion is not the current version." })
  public update(
    @CurrentUser() actor: UserPrincipal,
    @Param("projectId", idPipe) projectId: string,
    @Body(new ZodValidationPipe(PolicyUpdateRequestSchema)) body: PolicyUpdateRequest,
  ): Promise<ProjectPolicy> {
    return this.policies.update(actor, projectId, body);
  }

  @Get("versions")
  @ApiOperation({ summary: "Policy version history, newest first (admin)" })
  public versions(@Param("projectId", idPipe) projectId: string): Promise<PolicyVersionEntry[]> {
    return this.policies.listVersions(projectId);
  }
}
