# Workflow: set up alert channels

Alerts go to the in-app inbox always; email and chat are optional (ADR-009). Webhook URLs are secrets: treat them like passwords, paste them only into the DevGuard dashboard, never into chat, tickets or code.

## Slack
1. Go to api.slack.com/apps, **Create New App** (from scratch), pick a name and your workspace.
2. Open **Incoming Webhooks** and turn **Activate Incoming Webhooks** on.
3. Click **Add New Webhook to Workspace**, choose the channel (for a private channel you must be a member), and **Authorize**.
4. Copy the URL (`https://hooks.slack.com/services/...`; tied to one channel).
5. In DevGuard: Project -> Alert settings -> Slack -> paste -> **Send test**.

## Microsoft Teams
The legacy "Incoming Webhook" Office 365 connector has been retired (Microsoft's rollout started 18 May 2026; check Microsoft's current documentation for exact dates). Use **Workflows** (Power Automate):
1. In Teams, open the target channel -> **More options (...)** -> **Workflows**.
2. Choose the template **Post to a channel when a webhook request is received**, name it, and select the team and channel.
3. Copy the generated webhook URL (host is `api.powerautomate.com`, `api.powerplatform.com`/`*.powerplatform.com` or `flow.microsoft.com`).
4. In DevGuard: Project -> Alert settings -> Teams -> paste -> **Send test**.
Notes: the workflow posts using the creating account's sign-in and that account must be a member of the team, so use a **service account**, not a personal one (it breaks if the person leaves). Payloads are Adaptive Cards. Private/shared channel support was still being rolled out; verify against current Microsoft docs. DevGuard only accepts the hostnames above.

## Email (SMTP)
Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` and `DASHBOARD_BASE_URL` in the API environment (secrets via your secret store, never committed). Leave `SMTP_HOST` empty to turn alerts off. In the current minimal build ([ADR-016](../decisions/ADR-016-minimal-email-alerts.md)) mail goes to active security admins only, and there is no per-user opt-out yet.

## Local development (no real mail or chat)
`docker compose up -d mailpit`: SMTP on `localhost:1025`, inbox UI at http://localhost:8025. `.env.example` already points `SMTP_HOST` there. Slack/Teams cannot be tested locally without a real webhook; automated tests use a local fake receiver and bypass the allowlist only through an explicit test configuration.

## Failure behavior
In the minimal build a failed mail is logged and dropped (no retries). In the full design a failed delivery is retried with backoff up to a cap, then marked `failed` and shown in the admin delivery log. It never blocks event ingestion or a push decision. Alerts are best-effort; the dashboard is the record.
