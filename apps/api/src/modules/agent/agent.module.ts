import { Module } from "@nestjs/common";
import { DestinationsModule } from "../destinations/destinations.module.js";
import { FingerprintsModule } from "../fingerprints/fingerprints.module.js";
import { PoliciesModule } from "../policies/policies.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { AgentController } from "./agent.controller.js";
import { AgentService } from "./agent.service.js";

@Module({ imports: [ProjectsModule, PoliciesModule, DestinationsModule, FingerprintsModule], controllers: [AgentController], providers: [AgentService] })
export class AgentModule {}
