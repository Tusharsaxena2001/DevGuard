import { Module } from "@nestjs/common";
import { DestinationsModule } from "../destinations/destinations.module.js";
import { EventsModule } from "../events/events.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { UsersModule } from "../users/users.module.js";
import { AgentExceptionsController } from "./agent-exceptions.controller.js";
import { ExceptionsController } from "./exceptions.controller.js";
import { ExceptionsRepository } from "./exceptions.repository.js";
import { ExceptionsService } from "./exceptions.service.js";

@Module({
  imports: [ProjectsModule, DestinationsModule, EventsModule, UsersModule],
  controllers: [ExceptionsController, AgentExceptionsController],
  providers: [ExceptionsService, ExceptionsRepository],
  exports: [ExceptionsService],
})
export class ExceptionsModule {}
