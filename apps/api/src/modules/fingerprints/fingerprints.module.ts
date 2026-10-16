import { Module } from "@nestjs/common";
import { DestinationsModule } from "../destinations/destinations.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { FingerprintsController } from "./fingerprints.controller.js";
import { FingerprintsRepository } from "./fingerprints.repository.js";
import { FingerprintsService } from "./fingerprints.service.js";

@Module({
  imports: [ProjectsModule, DestinationsModule],
  controllers: [FingerprintsController],
  providers: [FingerprintsService, FingerprintsRepository],
  exports: [FingerprintsService],
})
export class FingerprintsModule {}
