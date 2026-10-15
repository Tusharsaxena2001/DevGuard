# API-6 Exceptions / approvals (apps/api)

**Responsibility:** request, decide, validate and expire destination exceptions (ADR-007).
**Depends on:** API-4, API-5.

## Contract
- `POST /exceptions` (device or user): {projectId, destination, reason, eventId?}; destination normalized; creates `pending`.
- `GET /exceptions` (scoped; filter by status), `GET /exceptions/:id` with decision history.
- `POST /exceptions/:id/approve` {reason, expiresAt}, `POST /exceptions/:id/reject` {reason}, `POST /exceptions/:id/revoke` — approver role in project or admin; approver != requester (403); `expiresAt` must be future and <= cap.
- `POST /agent/exceptions/validate` (device auth) {project, destination}: uses `validateException` from policy-engine with server time; returns `{valid, exceptionId?, expiresAt?, approverId?}`.
- Expiry enforced at validation time (no reliance on a cron); optional sweeper marks `expired`.
## Acceptance
Self-approval blocked; non-scoped approver blocked; wrong destination/project invalid; expired and revoked invalid; boundary time test; every state change audited; client-supplied approval claims ignored.
