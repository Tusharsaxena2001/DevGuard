import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { ReportFingerprintRequestSchema, type AgentProjectSync, type ReportFingerprintRequest } from "@devguard/shared";
import { API_V1 } from "../../common/api-version.js";
import { CurrentDevice, DeviceAuth } from "../../common/auth/decorators.js";
import type { DevicePrincipal } from "../../common/auth/principals.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { AgentService } from "./agent.service.js";

/** Endpoints for the laptop agent: device credential only. */
@ApiTags("agent")
@DeviceAuth()
@Controller(`${API_V1}/agent`)
export class AgentController {
  public constructor(@Inject(AgentService) private readonly agent: AgentService) {}

  @Get("projects")
  @ApiOperation({ summary: "Every project assigned to the device's owner: policy, destinations, canonical repos, fingerprints. ETag / If-None-Match supported." })
  public async projects(
    @CurrentDevice() device: DevicePrincipal,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AgentProjectSync | undefined> {
    const sync = await this.agent.syncProjects(device);
    res.setHeader("ETag", sync.etag);
    res.setHeader("Cache-Control", "private, no-cache");
    if (ifNoneMatch === sync.etag) {
      res.status(304);
      return undefined;
    }
    return sync.body;
  }

  @Post("repo-fingerprints")
  @HttpCode(204)
  @ApiOperation({ summary: "Report a repo's root commit for a project it matched by remote (device)" })
  public reportFingerprint(
    @CurrentDevice() device: DevicePrincipal,
    @Body(new ZodValidationPipe(ReportFingerprintRequestSchema)) body: ReportFingerprintRequest,
  ): Promise<void> {
    return this.agent.reportFingerprint(device, body);
  }
}
