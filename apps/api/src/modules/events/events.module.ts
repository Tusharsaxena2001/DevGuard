import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module.js";
import { UsersModule } from "../users/users.module.js";
import { EventsController } from "./events.controller.js";
import { EventsRepository } from "./events.repository.js";
import { EventsService } from "./events.service.js";

@Module({ imports: [ProjectsModule, UsersModule], controllers: [EventsController], providers: [EventsService, EventsRepository], exports: [EventsService] })
export class EventsModule {}
