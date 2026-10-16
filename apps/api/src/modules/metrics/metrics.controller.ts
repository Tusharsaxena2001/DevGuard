import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { MetricsQuerySchema, type MetricsQuery, type MetricsSummary } from "@devguard/shared";
import { API_V1 } from "../../common/api-version.js";
import { Roles } from "../../common/auth/decorators.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { MetricsService } from "./metrics.service.js";

@ApiTags("metrics")
@Roles("security_admin")
@Controller(`${API_V1}/metrics`)
export class MetricsController {
  public constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  @Get("summary")
  @ApiOperation({ summary: "Counts by outcome, top rules, blocked per project and day, exceptions, device health, recent incidents (admin). Computed from the database on request." })
  public summary(@Query(new ZodValidationPipe(MetricsQuerySchema)) query: MetricsQuery): Promise<MetricsSummary> {
    return this.metrics.summary(query);
  }
}
