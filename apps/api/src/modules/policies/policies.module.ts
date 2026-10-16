import { Module } from "@nestjs/common";
import { DestinationsModule } from "../destinations/destinations.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { PoliciesController } from "./policies.controller.js";
import { PoliciesRepository } from "./policies.repository.js";
import { PoliciesService } from "./policies.service.js";

@Module({
  imports: [ProjectsModule, DestinationsModule],
  controllers: [PoliciesController],
  providers: [PoliciesService, PoliciesRepository],
  exports: [PoliciesService],
})
export class PoliciesModule {}
