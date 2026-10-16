import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module.js";
import { DestinationsController } from "./destinations.controller.js";
import { DestinationsRepository } from "./destinations.repository.js";
import { DestinationsService } from "./destinations.service.js";

@Module({ imports: [ProjectsModule], controllers: [DestinationsController], providers: [DestinationsService, DestinationsRepository], exports: [DestinationsService] })
export class DestinationsModule {}
