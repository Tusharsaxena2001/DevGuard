import { Inject, Injectable } from "@nestjs/common";
import { HealthRepository } from "./health.repository.js";

export interface HealthReport {
  readonly status: "ok" | "degraded";
}

@Injectable()
export class HealthService {
  public constructor(@Inject(HealthRepository) private readonly repository: HealthRepository) {}

  public async check(): Promise<HealthReport> {
    return { status: (await this.repository.isDatabaseReachable()) ? "ok" : "degraded" };
  }
}
