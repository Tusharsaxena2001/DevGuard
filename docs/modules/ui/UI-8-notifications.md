# UI-8 Notifications and alert settings (apps/dashboard)

**Responsibility:** let people see alerts in the dashboard and configure where they are sent.
**Depends on:** API-8, UI-1.

## Contract
- Header bell with unread count; inbox page (list, mark read, filter unread) with deep links to the event or exception request.
- Per-user preference: email alerts on/off.
- Per-project alert settings (owner/admin only; visibility is convenience, API enforces): connect Slack or Teams by pasting a webhook URL (write-only field, shown afterwards as masked host + status), "Send test", remove. Link to `docs/workflows/alert-channels-setup.md` instructions in-page.
- Admin delivery log: status, attempts, sanitised error.
## Structure
`features/notifications/{api,components,pages}`; query hooks only for server state; no URL ever stored in client state beyond the submit action.
## Acceptance
Unread count updates; deep links work; masked URL display; test-send success/failure states; empty/loading/error states; forbidden state for non-owners.
