import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  ExceptionQuerySchema,
  ExceptionRequestInputSchema,
  ExceptionValidationRequestSchema,
  type ExceptionEntry,
  type ExceptionPage,
  type ExceptionQuery,
  type ExceptionRequestInput,
  type ExceptionValidationResult,
} from "@devguard/shared";
import { API_V1 } from "../../common/api-version.js";
import { CurrentDevice, DeviceAuth } from "../../common/auth/decorators.js";
import type { DevicePrincipal } from "../../common/auth/principals.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ExceptionsService } from "./exceptions.service.js";

const idPipe = new ZodValidationPipe(z.uuid());
const ownScope = (device: DevicePrincipal): { userId: string; isAdmin: false } => ({ userId: device.userId, isAdmin: false });

/** Agent routes (device credential). A device only ever sees and uses its owner's own requests. */
@ApiTags("agent")
@DeviceAuth()
@Controller(`${API_V1}/agent/exceptions`)
export class AgentExceptionsController {
  public constructor(@Inject(ExceptionsService) private readonly exceptions: ExceptionsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Request an exception for a blocked push (device). The owner must be assigned to the project." })
  public request(@CurrentDevice() device: DevicePrincipal, @Body(new ZodValidationPipe(ExceptionRequestInputSchema)) body: ExceptionRequestInput): Promise<ExceptionEntry> {
    return this.exceptions.request({ userId: device.userId, deviceId: device.deviceId }, body);
  }

  @Get()
  @ApiOperation({ summary: "The device owner's own requests and their status (device)" })
  public list(@CurrentDevice() device: DevicePrincipal, @Query(new ZodValidationPipe(ExceptionQuerySchema)) query: ExceptionQuery): Promise<ExceptionPage> {
    return this.exceptions.list(ownScope(device), query);
  }

  @Post("validate")
  @HttpCode(200)
  @ApiOperation({ summary: "May the device's owner push this project to this destination now? Decided from server records and the server clock only." })
  public validate(@CurrentDevice() device: DevicePrincipal, @Body(new ZodValidationPipe(ExceptionValidationRequestSchema)) body: { projectId: string; destination: string }): Promise<ExceptionValidationResult> {
    return this.exceptions.validate(device, body);
  }

  @Get(":id")
  @ApiOperation({ summary: "One of the device owner's own requests (device)" })
  public get(@CurrentDevice() device: DevicePrincipal, @Param("id", idPipe) id: string): Promise<ExceptionEntry> {
    return this.exceptions.get(ownScope(device), id);
  }
}
