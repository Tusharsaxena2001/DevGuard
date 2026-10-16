import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module.js";
import { DevicesController } from "./devices.controller.js";
import { DevicesRepository } from "./devices.repository.js";
import { DevicesService } from "./devices.service.js";

@Module({ imports: [UsersModule], controllers: [DevicesController], providers: [DevicesService, DevicesRepository], exports: [DevicesService] })
export class DevicesModule {}
