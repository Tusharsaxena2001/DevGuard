import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module.js";
import { MetricsController } from "./metrics.controller.js";
import { MetricsRepository } from "./metrics.repository.js";
import { MetricsService } from "./metrics.service.js";

@Module({ imports: [EventsModule], controllers: [MetricsController], providers: [MetricsService, MetricsRepository] })
export class MetricsModule {}
