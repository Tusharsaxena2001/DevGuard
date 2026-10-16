import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { RemoteUrlRequestSchema, type CanonicalRepoEntry, type DestinationEntry, type RemoteUrlRequest } from "@devguard/shared";
import { API_V1 } from "../../common/api-version.js";
import { CurrentUser, Roles } from "../../common/auth/decorators.js";
import type { UserPrincipal } from "../../common/auth/principals.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { DestinationsService } from "./destinations.service.js";

const idPipe = new ZodValidationPipe(z.uuid());
const bodyPipe = new ZodValidationPipe(RemoteUrlRequestSchema);

@ApiTags("destinations")
@Roles("security_admin")
@Controller(`${API_V1}/projects/:projectId`)
export class DestinationsController {
  public constructor(@Inject(DestinationsService) private readonly destinations: DestinationsService) {}

  @Get("destinations")
  @ApiOperation({ summary: "Approved destinations of a project (admin)" })
  public list(@Param("projectId", idPipe) projectId: string): Promise<DestinationEntry[]> {
    return this.destinations.listDestinations(projectId);
  }

  @Post("destinations")
  @HttpCode(201)
  @ApiOperation({ summary: "Approve a destination; the URL is normalized, lookalikes and malformed URLs are rejected (admin)" })
  public add(@CurrentUser() actor: UserPrincipal, @Param("projectId", idPipe) projectId: string, @Body(bodyPipe) body: RemoteUrlRequest): Promise<DestinationEntry> {
    return this.destinations.addDestination(actor, projectId, body.url);
  }

  @Delete("destinations/:id")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove an approved destination (admin)" })
  public remove(@CurrentUser() actor: UserPrincipal, @Param("projectId", idPipe) projectId: string, @Param("id", idPipe) id: string): Promise<void> {
    return this.destinations.removeDestination(actor, projectId, id);
  }

  @Get("canonical-repos")
  @ApiOperation({ summary: "Canonical repos used by agents to recognise the project by remote (admin)" })
  public listCanonical(@Param("projectId", idPipe) projectId: string): Promise<CanonicalRepoEntry[]> {
    return this.destinations.listCanonicalRepos(projectId);
  }

  @Post("canonical-repos")
  @HttpCode(201)
  @ApiOperation({ summary: "Add a canonical repo (admin). Canonical repos are implicitly approved destinations." })
  public addCanonical(@CurrentUser() actor: UserPrincipal, @Param("projectId", idPipe) projectId: string, @Body(bodyPipe) body: RemoteUrlRequest): Promise<CanonicalRepoEntry> {
    return this.destinations.addCanonicalRepo(actor, projectId, body.url);
  }

  @Delete("canonical-repos/:id")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a canonical repo (admin)" })
  public removeCanonical(@CurrentUser() actor: UserPrincipal, @Param("projectId", idPipe) projectId: string, @Param("id", idPipe) id: string): Promise<void> {
    return this.destinations.removeCanonicalRepo(actor, projectId, id);
  }
}
