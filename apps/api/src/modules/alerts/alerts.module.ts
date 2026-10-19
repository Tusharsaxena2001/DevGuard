import { Module } from "@nestjs/common";
import type { Env } from "../../config/env.js";
import { ENV } from "../../config/env.token.js";
import { DevicesModule } from "../devices/devices.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { UsersModule } from "../users/users.module.js";
import { AlertsService } from "./alerts.service.js";
import { MAIL_SENDER, NoopMailSender, type MailSender } from "./mail-sender.js";
import { NodemailerMailSender } from "./nodemailer-mail-sender.js";

const createMailSender = (env: Env): MailSender =>
  env.SMTP_HOST === undefined
    ? new NoopMailSender()
    : new NodemailerMailSender({ host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, password: env.SMTP_PASSWORD, from: env.SMTP_FROM });

@Module({
  imports: [UsersModule, ProjectsModule, DevicesModule],
  providers: [AlertsService, { provide: MAIL_SENDER, useFactory: createMailSender, inject: [ENV] }],
  exports: [AlertsService, MAIL_SENDER],
})
export class AlertsModule {}
