import nodemailer, { type Transporter } from "nodemailer";
import type { MailMessage, MailSender } from "./mail-sender.js";

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string | undefined;
  readonly password: string | undefined;
  readonly from: string;
}

const TIMEOUT_MS = 10_000;

/** SMTP adapter. Credentials stay inside the transport; they are never logged or put in an error message. */
export class NodemailerMailSender implements MailSender {
  private readonly transport: Transporter;

  public constructor(private readonly settings: SmtpSettings) {
    this.transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.port === 465,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
      // Credentials are never offered over a connection that could be downgraded to plaintext (STARTTLS stripping).
      ...(settings.user !== undefined && settings.password !== undefined ? { requireTLS: true, auth: { user: settings.user, pass: settings.password } } : {}),
    });
  }

  public async send(message: MailMessage): Promise<void> {
    // One message per recipient so admins do not see each other's addresses.
    for (const to of message.to) {
      await this.transport.sendMail({ from: this.settings.from, to, subject: message.subject, text: message.text });
    }
  }
}
