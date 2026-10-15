# API-7 Admin audit and metrics (apps/api)

**Responsibility:** expose append-only administrative audit history and dashboard aggregates.
**Depends on:** API-2..API-6.

## Contract
- `GET /audit` (scoped filters: actor, action, target, date; paginated). No write/update/delete routes; writes only via an internal `AuditService.record()` called by other modules in the same transaction as the change.
- `GET /metrics/summary?range=` : counts by outcome, top rules, blocked per project/day, pending exceptions, active/stale/revoked devices, recent incidents (latest N events).
## Acceptance
Every mutating admin operation from API-2..6 has a test asserting an audit row; scoping tests; metrics computed from DB (no hardcoded data) and match seeded counts; audit rows cannot be modified through any route.
