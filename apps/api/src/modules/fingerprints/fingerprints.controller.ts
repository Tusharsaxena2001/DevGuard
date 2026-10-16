import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AddFingerprintRequestSchema,
  RegisterRepoRequestSchema,
  type AddFingerprintRequest,
  type FingerprintEntry,
  type RegisterRepoRequest,
  type RepoRegistrationEntry,
} from "@devguard/shared";
import { API_V1 } from "../../common/api-version.js";
import { CurrentDevice, CurrentUser, DeviceAuth, Roles } from "../../common/auth/decorators.js";
import type { DevicePrincipal, UserPrincipal } from "../../common/auth/principals.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { FingerprintsService } from "./fingerprints.service.js";

const idPipe = new ZodValidationPipe(z.uuid());

/** Roles are per method: the device route on this controller must not inherit an admin requirement. */
@ApiTags("fingerprints")
@Controller(`${API_V1}/projects/:projectId`)
export class FingerprintsController {
  public constructor(@Inject(FingerprintsService) private readonly fingerprints: FingerprintsService) {}

  @Get("fingerprints")
  @Roles("security_admin")
  @ApiOperation({ summary: "Repo fingerprints (root commits) of a project, with their source (admin)" })
  public list(@Param("projectId", idPipe) projectId: string): Promise<FingerprintEntry[]> {
    return this.fingerprints.list(projectId);
  }

  @Post("fingerprints")
  @Roles("security_admin")
  @HttpCode(201)
  @ApiOperation({ summary: "Add a fingerprint manually (admin)" })
  public add(
    @CurrentUser() actor: UserPrincipal,
    @Param("projectId", idPipe) projectId: string,
    @Body(new ZodValidationPipe(AddFingerprintRequestSchema)) body: AddFingerprintRequest,
  ): Promise<FingerprintEntry> {
    return this.fingerprints.addManual(actor, projectId, body.fingerprint);
  }

  @Delete("fingerprints/:id")
  @Roles("security_admin")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a fingerprint, including a device-reported one (admin)" })
  public remove(@CurrentUser() actor: UserPrincipal, @Param("projectId", idPipe) projectId: string, @Param("id", idPipe) id: string): Promise<void> {
    return this.fingerprints.remove(actor, projectId, id);
  }

  @Get("repos")
  @Roles("security_admin")
  @ApiOperation({ summary: "Repos registered by devices for the project (admin)" })
  public repos(@Param("projectId", idPipe) projectId: string): Promise<RepoRegistrationEntry[]> {
    return this.fingerprints.listRegistrations(projectId);
  }

  @Post("repos")
  @DeviceAuth()
  @HttpCode(204)
  @ApiOperation({ summary: "Register the device's repo to a project it is assigned to (device)" })
  public register(
    @CurrentDevice() device: DevicePrincipal,
    @Param("projectId", idPipe) projectId: string,
    @Body(new ZodValidationPipe(RegisterRepoRequestSchema)) body: RegisterRepoRequest,
  ): Promise<void> {
    return this.fingerprints.register(device, projectId, body.fingerprint);
  }
}
