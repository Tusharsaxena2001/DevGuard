export interface MailMessage {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
}

/** Port for outgoing mail. The service depends on this, never on nodemailer. */
export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

export const MAIL_SENDER = Symbol("MAIL_SENDER");

/** Used when SMTP is not configured: alerts are off, nothing is sent. */
export class NoopMailSender implements MailSender {
  public send(): Promise<void> {
    return Promise.resolve();
  }
}
