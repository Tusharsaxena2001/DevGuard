# ADR-016: Minimal email alerts (API-8 reduced scope)

**Status:** accepted
**Context:** API-8 (ADR-009) specifies an inbox, email, Slack/Teams, an outbox with retries and throttling. With project-scoped roles deferred (ADR-014) and limited time, the part worth building first is: tell security admins by email when something important happens.

## Decision
- **Triggers** (from `AlertsService.onEventsRecorded`, called by `EventsService.ingest`): a push **blocked in enforce mode**, or an event whose rules include `secret_detected` or `scan_error` and that is not audit-only. Audit-only events never alert. One mail per event. Exception requested/decided mails are not built.
- **Recipients:** active users with a global `security_admin` membership. There are no owners or team leads to resolve (ADR-014). No recipients means nothing is sent.
- **Delivery:** fire and forget, after the events are stored. Failures are logged (error class only) and dropped: no outbox, no retries, no throttling, no new tables. A burst of blocked pushes sends one mail per event. Ingestion and push decisions never wait for, or depend on, mail.
- **Only newly accepted events alert**, so a resubmitted batch is not mailed twice.
- **Content:** metadata only (project, employee, device, destination, operation, outcome/mode, rule ids, time, dashboard link). Never findings, file paths, contents or secret values (ADR-005). Control characters are stripped from agent-supplied text. The mail says the hook observed a push attempt, not whether data was exfiltrated.
- **Configuration:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Alerts are off when `SMTP_HOST` is unset or blank. Credentials stay inside the nodemailer transport and are not logged. The mailer sits behind a `MailSender` port; tests replace its `send`.

## Known risk: mail flooding
A batch holds up to 100 events and every blocked event sends one mail to every admin, so a compromised or malicious enrolled device can send many mails (bounded only by the global request throttle). Not mitigated in this slice; a per-device cap or digest mail belongs with the full API-8 throttling. Only a bounded number of alerts (50) may be waiting at once; further ones are dropped and logged.
SMTP credentials are only used over TLS (`requireTLS`); a server without TLS works only without credentials (Mailpit in development).

## Consequences
- A mail can be lost (SMTP down, process stops mid-send); the dashboard events page remains the record.
- No per-user opt-out and no throttling; both belong to the full API-8.
- Deferred and unchanged in the API-8 spec: inbox, Slack/Teams, per-project recipients, exception mails, outbox with retries, throttling, preferences.
