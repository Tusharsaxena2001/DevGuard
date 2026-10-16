import { Controller, Get, Inject, Res } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiProperty, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../../common/auth/decorators.js";
import { HealthService, type HealthReport } from "./health.service.js";

/** OpenAPI description of the response; the runtime value is the plain `HealthReport`. */
class HealthReportDoc implements HealthReport {
  @ApiProperty({ enum: ["ok", "degraded"] })
  public status!: "ok" | "degraded";
}

@ApiTags("health")
@Public()
@Controller("health")
export class HealthController {
  public constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: "Liveness and database reachability (public, no details)" })
  @ApiOkResponse({ type: HealthReportDoc })
  @ApiServiceUnavailableResponse({ type: HealthReportDoc })
  public async get(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status !== "ok") res.status(503);
    return report;
  }
}
