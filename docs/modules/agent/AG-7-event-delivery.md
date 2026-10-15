# AG-7 Event delivery (apps/agent)

**Responsibility:** build minimal, redacted security events and deliver reliably.
**Depends on:** AG-5, API-5.

## Contract
- Event = SH-1 `SecurityEventInput` (timestamp, project id, destination host/repo, operation, refs, decision, rule ids, mode, outcome, correlation id, policy version, exception ref). Built only from `Decision` + metadata; no content.
- Delivery: POST with device auth; on failure append to `spool/` (bounded size, oldest dropped with a counter); retry on next command/push. Delivery failure never changes push decision.
- Same correlation id shown to the developer in the block message.
## Acceptance
Schema-strict (extra fields rejected), spool and replay, idempotency key prevents duplicates, no secret/content in event or logs (fixture with synthetic secret asserted absent).
