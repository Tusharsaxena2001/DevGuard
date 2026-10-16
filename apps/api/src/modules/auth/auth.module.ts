import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { DevicesModule } from "../devices/devices.module.js";
import { UsersModule } from "../users/users.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { RolesGuard } from "./roles.guard.js";

/** Registers the global guards in order: authenticate first, then check roles. */
@Module({
  imports: [UsersModule, DevicesModule],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: RolesGuard }],
  exports: [AuthService],
})
export class AuthModule {}
