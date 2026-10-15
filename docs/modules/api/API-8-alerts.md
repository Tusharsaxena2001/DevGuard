# API-8 Alerts and notifications (apps/api)

**Responsibility:** notify the responsible people when something needs attention (ADR-009).
**Depends on:** API-2 (memberships), API-5 (events), API-6 (exceptions).

## Structure (per engineering standards)
`modules/alerts/`: `alerts.service` (trigger handling, recipient resolution, throttling), `recipients.resolver` (membership-scoped), `notification.repository`, `delivery.repository`, `channels/` (`email.channel`, `slack.channel`, `teams.channel` behind a `ChannelSender` interface), `webhook-url.guard` (https + allowlist + DNS/private-range checks), `secret-box` (AES-256-GCM), `delivery.worker` (scheduled), controllers for notifications, preferences, channels, deliveries.

## Contract (REST, `/v1`)
- `GET /notifications` (own, unread filter, paginated), `POST /notifications/:id/read`.
- `PUT /me/notification-preferences` {emailEnabled}.
- `PUT /projects/:id/alert-channels` {type: slack|teams, webhookUrl} / `DELETE` (project owner or admin; URL validated, encrypted; response never contains it, only masked host and status), `POST /projects/:id/alert-channels/test`.
- `GET /alerts/deliveries` (security admin; filter by status; failures visible).
- Internal: `AlertsService.onEventRecorded(event)`, `onExceptionRequested`, `onExceptionDecided` called by API-5/API-6 services after commit; failures here must not roll back or fail those operations.

## Data
`Notification` (userId, kind, projectId, refType/refId, title, body, count, readAt), `Delivery` (notificationId, channel, status pending|sent|failed, attempts, nextAttemptAt, lastError (sanitised)), `ProjectAlertChannel` (projectId, type, encryptedUrl, urlHost, createdBy), `NotificationPreference` (userId, emailEnabled). Created with the triggering change (outbox).

## Security invariants
Recipients resolved server-side by membership; users see only their notifications; webhook URLs never returned or logged; SSRF checks at configure and at send time; bodies carry no contents/secrets; every channel change is audited; delivery errors stored without the URL or response bodies containing secrets.

## Acceptance / tests
Recipients limited to project scope (no cross-project leak); each trigger reaches the right roles; throttling coalesces; retry/backoff and max attempts; SSRF rejections (http, IP literal, localhost, private DNS result, non-allowlisted host, redirect); URL absent from responses and logs; email opt-out respected; delivery failure does not affect event ingestion; Slack and Teams payload shapes validated (Teams = Adaptive Card message).
