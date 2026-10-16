import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  CreateProjectRequestSchema,
  SetMembersRequestSchema,
  UpdateProjectRequestSchema,
  type CreateProjectRequest,
  type ProjectSummary,
  type SetMembersRequest,
  type UpdateProjectRequest,
} from "@devguard/shared";
import { API_V1 } from "../../common/api-version.js";
import { CurrentUser, Roles } from "../../common/auth/decorators.js";
import type { UserPrincipal } from "../../common/auth/principals.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ProjectsService } from "./projects.service.js";

const idPipe = new ZodValidationPipe(z.uuid());

@ApiTags("projects")
@Roles("security_admin")
@Controller(`${API_V1}/projects`)
export class ProjectsController {
  public constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: "List projects (admin)" })
  public list(): Promise<ProjectSummary[]> {
    return this.projects.list();
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Create a project with its first policy version (admin)" })
  public create(@CurrentUser() actor: UserPrincipal, @Body(new ZodValidationPipe(CreateProjectRequestSchema)) body: CreateProjectRequest): Promise<ProjectSummary> {
    return this.projects.create(actor, body);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a project (admin)" })
  public get(@Param("id", idPipe) id: string): Promise<ProjectSummary> {
    return this.projects.get(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Rename a project or change its classification (admin)" })
  public update(
    @CurrentUser() actor: UserPrincipal,
    @Param("id", idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateProjectRequestSchema)) body: UpdateProjectRequest,
  ): Promise<ProjectSummary> {
    return this.projects.update(actor, id, body);
  }

  @Put(":id/members")
  @ApiOperation({ summary: "Replace the employees assigned to a project (admin). Only assigned employees' devices receive it." })
  public setMembers(
    @CurrentUser() actor: UserPrincipal,
    @Param("id", idPipe) id: string,
    @Body(new ZodValidationPipe(SetMembersRequestSchema)) body: SetMembersRequest,
  ): Promise<ProjectSummary> {
    return this.projects.setMembers(actor, id, body);
  }
}
