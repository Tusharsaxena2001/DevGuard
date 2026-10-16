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

## Implemented (apps/api)
- **Scope (ADR-014):** admins see all events; every other user sees only their own (an employee's `userId`/`projectId` filters cannot widen that). There are no lead/owner scoped views.
- **`POST /v1/agent/events`** (device credential only): body `SecurityEventBatch` (SH-1, strict, 1 to 100 events; JSON body limit 2 MB, the agent keeps requests under 1 MB). Reply `200 { results: [{ idempotencyKey, status }] }` in order, status `accepted` | `duplicate` | `rejected`. Device and owner come from the credential, never the body (an `userId`/`deviceId` field is an unknown key => 400). An event whose `projectId` is not one the owner is assigned to is `rejected` (final, not stored; the rest of the batch is still stored); a malformed event rejects the whole batch with 400; a key this device already delivered is `duplicate` (unique `(deviceId, idempotencyKey)`; also de-duplicated within a batch and safe under concurrent redelivery).
- **Data minimisation:** the schema is strict at every level (`SecurityEventInput`, `Finding`), so `content`, `diff`, `match`, `text` etc. are 400 and nothing is stored (tested with a synthetic token). Stored per event: time, device, owner, project, destination host/repo (nullable when unparsable), operation, refs, rule ids, findings (rule id, kind, path, line, commit), mode, would-block flag, outcome, correlation id, policy version, exception id, agent version, idempotency key. Branch names and paths are client text and could contain anything their author typed; they are metadata, not scanned.
- **`GET /v1/events`**: filters `projectId`, `deviceId`, `userId`, `outcome`, `ruleId`, `correlationId` (the reference shown to the developer), `destHost`, `destRepo`, `from`, `to`; `page` (from 1) and `pageSize` (default 50, max 200); newest first; returns `{items, total, page, pageSize}` with device, user and project names. Unknown query keys are 400. **`GET /v1/events/:id`**: admin or owner; anyone else gets 404.
- **Schema:** `SecurityEvent` gained `refs`, `findings`, `wouldBlock`, `agentVersion`, `idempotencyKey`; `destHost`, `destRepo` and `mode` became nullable (an unparsable URL or an unprotected repo has none). Migration `security_event_ingestion`. Existing rows are untouched (their key is null).
- **Honesty:** an event says the hook observed a push attempt and what it decided. It does not prove that data was or was not exfiltrated (`--no-verify`, other clients and a removed hook leave no event). Replay and forgery by someone holding a device secret are accepted (ADR-006).
- **Tests:** `test/events.e2e.test.ts` (identity from credential, content rejection, idempotency incl. per-device keys, cross-project rejection, null project/destination/mode, revoked and wrong credentials, batch size and body limits, filters, pagination, employee scoping, 404 for others' events).
- **Security review:** independent read-only review found no critical issues. Fixed: an event whose `projectId` or `exceptionId` is not a UUID is a final `rejected` for that event instead of a 500 for the batch; deep pages (`page * pageSize` > 20 000) are 400. Accepted: `exceptionId`, `outcome` and `wouldBlock` are agent-reported and not cross-checked against server records, so the dashboard must label them as reported by the agent; `ruleId`, `destHost` and `destRepo` filters are unindexed (admin queries scan).
- **Known gaps:** no retention or archiving (the table grows); no full-text or substring search; `refs` and `path` are unscanned client text; rejected events are not recorded anywhere server-side (the agent drops them, visible only as the `dropped` count on the agent if applicable).
