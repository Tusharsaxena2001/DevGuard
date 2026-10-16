import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module.js";
import { AuditController } from "./audit.controller.js";
import { AuditRepository } from "./audit.repository.js";
import { AuditService } from "./audit.service.js";

@Module({ imports: [UsersModule], controllers: [AuditController], providers: [AuditService, AuditRepository] })
export class AuditModule {}
