import { Inject, Injectable, Logger } from "@nestjs/common";
import type { SecurityEventInput } from "@devguard/shared";
import type { DevicePrincipal } from "../../common/auth/principals.js";
import type { Env } from "../../config/env.js";
import { ENV } from "../../config/env.token.js";
import { DevicesService } from "../devices/devices.service.js";
import { ProjectsService } from "../projects/projects.service.js";
import { UsersService } from "../users/users.service.js";
import { buildAlertMessage } from "./alert-message.js";
import { alertReason } from "./alert-rules.js";
import { MAIL_SENDER, type MailSender } from "./mail-sender.js";

/** Bounds memory when SMTP is slow: further alerts are dropped (and logged) until some finish. */
const MAX_IN_FLIGHT = 50;

/**
 * Best-effort email alerts (ADR-016). Called after events are stored; it never throws and callers never wait for it, so a
 * mail failure cannot change an ingestion result or a push decision. No retries: a failed mail is logged and dropped.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly inFlight = new Set<Promise<void>>();

  public constructor(
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(DevicesService) private readonly devices: DevicesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Starts the alert work for newly stored events and returns at once. */
  public onEventsRecorded(device: DevicePrincipal, events: readonly SecurityEventInput[]): void {
    if (this.env.SMTP_HOST === undefined) return;
    if (this.inFlight.size >= MAX_IN_FLIGHT) {
      this.logger.warn("Alert email dropped: too many alerts are already waiting to be sent.");
      return;
    }
    const work = this.alertFor(device, events)
      .catch((error: unknown) => this.logger.warn(`Alert email failed (${error instanceof Error ? error.name : "unknown error"}).`))
      .finally(() => this.inFlight.delete(work));
    this.inFlight.add(work);
  }

  /** Resolves when every alert started so far has finished (tests and graceful shutdown). */
  public async idle(): Promise<void> {
    await Promise.all([...this.inFlight]);
  }

  private async alertFor(device: DevicePrincipal, events: readonly SecurityEventInput[]): Promise<void> {
    const alerting = events.flatMap((event) => {
      const reason = alertReason(event);
      return reason === null ? [] : [{ event, reason }];
    });
    if (alerting.length === 0) return;

    const recipients = await this.users.adminEmails();
    if (recipients.length === 0) return;
    const [userNames, deviceName] = await Promise.all([this.users.namesById([device.userId]), this.devices.nameById(device.deviceId)]);
    const projectIds = [...new Set(alerting.flatMap(({ event }) => (event.projectId === null ? [] : [event.projectId])))];
    const projectNames = new Map((await this.projects.findMany(projectIds)).map((p) => [p.id, p.name]));
    const base = this.env.DASHBOARD_BASE_URL.replace(/\/+$/, "");

    for (const { event, reason } of alerting) {
      const message = buildAlertMessage(
        {
          reason,
          event,
          projectName: event.projectId === null ? null : (projectNames.get(event.projectId) ?? null),
          userName: userNames.get(device.userId) ?? "unknown",
          deviceName: deviceName ?? "unknown",
          dashboardEventsUrl: `${base}/events`,
        },
        recipients,
      );
      try {
        await this.mail.send(message);
      } catch (error) {
        // One failed event mail must not stop the others. Only the error class is logged (it may carry server text).
        this.logger.warn(`Alert email failed (${error instanceof Error ? error.name : "unknown error"}).`);
      }
    }
  }
}
