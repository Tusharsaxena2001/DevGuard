# API-5 Security events (apps/api)

**Responsibility:** ingest and serve structured security events with minimal data.
**Depends on:** API-2, API-3.

## Contract
- `POST /agent/events` (device auth): strict Zod body (SH-1 `SecurityEventInput`), batch up to N, idempotency key; server sets device/user from credentials (client cannot spoof identity); project must be one the device is registered to; unknown/extra fields (e.g. content) => 400. Payload size limit.
- `GET /events` (user, scoped, filters: project, device, user, outcome, ruleId, date range, destination; pagination), `GET /events/:id`.
- Redaction guard rejects fields that look like content and strips nothing silently.
## Acceptance
Unauth/revoked device rejected; identity from credential not body; cross-project ingestion rejected; duplicate idempotency key no-op; employee sees only own events; lead sees scope; no content stored (test with synthetic secret in forbidden field -> 400).
## Notes
An event evidences an observed push attempt and decision; docs/UI must not state it proves leakage.
