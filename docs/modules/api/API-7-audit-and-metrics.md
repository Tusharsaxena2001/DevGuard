# API-7 Admin audit and metrics (apps/api)

**Responsibility:** expose append-only administrative audit history and dashboard aggregates.
**Depends on:** API-2..API-6.

## Contract
- `GET /audit` (scoped filters: actor, action, target, date; paginated). No write/update/delete routes; writes only via an internal `AuditService.record()` called by other modules in the same transaction as the change.
- `GET /metrics/summary?range=` : counts by outcome, top rules, blocked per project/day, pending exceptions, active/stale/revoked devices, recent incidents (latest N events).
## Acceptance
Every mutating admin operation from API-2..6 has a test asserting an audit row; scoping tests; metrics computed from DB (no hardcoded data) and match seeded counts; audit rows cannot be modified through any route.

## Implemented (apps/api)
- **Audit writing:** there is no `AuditService.record()`; each module writes its audit rows through `prisma/audit-write.ts` inside the repository transaction that makes the change (so a change and its audit row commit or fail together). Covered actions: `user.created`; `device.enrollment_token_issued`, `device.enrolled`, `device.revoked`; `project.created/updated/members_changed`; `destination.added/removed`; `canonical_repo.added/removed`; `fingerprint.added/reported/removed`; `repo.registered`; `policy.updated`; `exception.requested/approved/rejected/revoked`. Summaries are flat ids, names, counts and status words (a test asserts no credential or token appears in any row). The table is append-only in the database (triggers reject UPDATE, DELETE and TRUNCATE; tested).
- **`GET /v1/audit`** (admin): filters `actorId`, `action`, `actionPrefix` (a family such as `exception`), `targetType`, `targetId`, `from`, `to`; `page` / `pageSize` (default 50, max 200, `page * pageSize <= 20 000`); newest first; returns `{items, total, page, pageSize}` with actor names. Unknown query keys are 400. There is deliberately no route that creates, edits or deletes an entry (tested).
- **`GET /v1/metrics/summary?range=24h|7d|30d`** (admin, default 7d): `outcomes` (all four, zeros included), `totalEvents`, `topRules` (top 10), `blockedPerDay` (UTC day x project), `exceptions {pending, inForce}`, `devices {active, stale, revoked}` (stale = active but not heard from for 24 hours or never), `recentIncidents` (latest 10 blocked pushes, whatever the range). Computed from the tables on every request (no cache, nothing hard-coded); tests compare against rows they insert. The numbers count what the hook reported: pushes made with `--no-verify`, another Git client or a device without the agent are not in them.
- **Contracts:** `packages/shared/src/audit.ts`, `metrics.ts`.
- **Tests:** `test/audit-metrics.e2e.test.ts`.
- **Known gaps:** no CSV export; no per-project metrics filter; the metrics endpoint runs several aggregate queries per call (fine at hackathon scale); incidents are blocked pushes only (errors and exceptions are visible in the events list).

