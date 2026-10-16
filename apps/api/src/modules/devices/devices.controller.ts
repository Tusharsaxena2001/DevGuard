import { Body, Controller, Get, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  CreateEnrollmentTokenRequestSchema,
  EnrollRequestSchema,
  HeartbeatRequestSchema,
  type CreateEnrollmentTokenRequest,
  type DeviceSummary,
  type EnrollRequest,
  type EnrollResponse,
  type EnrollmentTokenResponse,
  type HeartbeatRequest,
} from "@devguard/shared";
import { API_V1 } from "../../common/api-version.js";
import { CurrentDevice, CurrentUser, DeviceAuth, Public, Roles, StrictThrottle } from "../../common/auth/decorators.js";
import type { DevicePrincipal, UserPrincipal } from "../../common/auth/principals.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { DevicesService } from "./devices.service.js";

const idPipe = new ZodValidationPipe(z.uuid());

@ApiTags("devices")
@Controller(`${API_V1}/devices`)
export class DevicesController {
  public constructor(@Inject(DevicesService) private readonly devices: DevicesService) {}

  @Post("enrollment-tokens")
  @Roles("security_admin")
  @HttpCode(201)
  @ApiOperation({ summary: "Issue a one-time enrollment token for an employee (admin). The token is returned once." })
  public issueToken(
    @CurrentUser() actor: UserPrincipal,
    @Body(new ZodValidationPipe(CreateEnrollmentTokenRequestSchema)) body: CreateEnrollmentTokenRequest,
  ): Promise<EnrollmentTokenResponse> {
    return this.devices.issueEnrollmentToken(actor, body);
  }

  @Post("enroll")
  @Public()
  @StrictThrottle()
  @HttpCode(201)
  @ApiOperation({ summary: "Exchange an enrollment token for a device id and secret (public, rate-limited). The secret is returned once." })
  public enroll(@Body(new ZodValidationPipe(EnrollRequestSchema)) body: EnrollRequest): Promise<EnrollResponse> {
    return this.devices.enroll(body);
  }

  @Post("heartbeat")
  @DeviceAuth()
  @HttpCode(204)
  @ApiOperation({ summary: "Device liveness; updates lastSeenAt (device credential)" })
  public async heartbeat(@CurrentDevice() device: DevicePrincipal, @Body(new ZodValidationPipe(HeartbeatRequestSchema)) body: HeartbeatRequest): Promise<void> {
    await this.devices.heartbeat(device, body);
  }

  @Get()
  @ApiOperation({ summary: "List devices: all for admins, own for everyone else" })
  public list(@CurrentUser() actor: UserPrincipal): Promise<DeviceSummary[]> {
    return this.devices.list(actor);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one device (admin or owner)" })
  public get(@CurrentUser() actor: UserPrincipal, @Param("id", idPipe) id: string): Promise<DeviceSummary> {
    return this.devices.get(actor, id);
  }

  @Post(":id/revoke")
  @Roles("security_admin")
  @HttpCode(200)
  @ApiOperation({ summary: "Revoke a device (admin)" })
  public revoke(@CurrentUser() actor: UserPrincipal, @Param("id", idPipe) id: string): Promise<DeviceSummary> {
    return this.devices.revoke(actor, id);
  }
}
