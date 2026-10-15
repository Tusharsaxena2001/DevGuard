# ADR-009: Alerting to the responsible people

**Status:** accepted
**Context:** Events and exception requests were only visible by opening the dashboard; nobody was notified.
**Decision:**
- **Triggers:** push blocked (enforce) -> project owner + team leads of that project. Exception requested -> approvers for the project (owner/leads), security admins if none. High severity (`secret_detected`, `scan_error`, repeated blocks by one device within a window, activity from a revoked device) -> security admins and the project owner. Exception approved/rejected -> the requester. Audit-only would-have-blocked events do **not** alert in the MVP (dashboard only) to avoid fatigue.
- **Channels:** in-app inbox (always), email via SMTP (per-user preference), Slack or Teams webhook (per project, configured by owner/admin).
- **Recipients are resolved server-side** from memberships; no recipient or scope is taken from the client.
- **Outbox pattern:** `Notification` (inbox) and `Delivery` (channel, status, attempts, nextAttemptAt) rows are created transactionally with the triggering change; a scheduled worker delivers with exponential backoff and a max-attempt cap. Delivery failure never affects event ingestion or push decisions.
- **Throttling:** coalesce per (project, rule, device) over a window (default 10 minutes), updating a count instead of sending duplicates.
- **Content:** project, employee, device, destination host/repo, rule id, outcome, time, deep link. Never file contents, secret values or tokens.
- **Webhook URLs are secrets:** encrypted at rest (AES-256-GCM, key from env), never returned (masked host only), never logged, changes audited.
- **SSRF protection:** https only; Slack `hooks.slack.com`; Teams `*.powerplatform.com`, `api.powerautomate.com`, `flow.microsoft.com`; reject IP literals, localhost and private ranges after DNS resolution; short timeout, no redirects, bounded response size.
- **Teams** uses Workflows (Power Automate) webhooks and Adaptive Card payloads; the legacy Office 365 connector is retired.
**Consequences:** alerts are best-effort convenience, not a security control; the dashboard remains the record. Slack/Teams hostname allowlists must be revisited if the vendors change URL formats. Local dev uses Mailpit so no real mail is sent.
