# API-3 Projects, assignments, repos, destinations (apps/api)

**Responsibility:** project lifecycle and everything the dashboard needs to configure protection without touching a laptop (ADR-008).
**Depends on:** API-2.

## Contract
- `POST/GET/PATCH /projects`, `GET /projects/:id` (scoped lists). Classification: internal | confidential | client_owned. Owners/leads assignable by admin/owner.
- **Canonical repos:** `POST/DELETE /projects/:id/canonical-repos` (URL normalized with `normalizeDestination`; used for remote-based matching by agents). Canonical repos are implicitly approved destinations.
- **Assignments:** `PUT /projects/:id/members` assigns employees (and later teams) to a project; only assigned employees' devices receive that project at sync. Every change audited.
- **Fingerprints:** `GET /projects/:id/fingerprints`, `POST` (admin/owner manual add), `DELETE`. Device-reported fingerprints arrive via `POST /agent/repo-fingerprints` (device auth): accepted only if the device's user is assigned to the project and the reported remote matched a canonical repo or destination; stored with `reportedByDeviceId`, `source` (device|manual), `createdAt`. Visible and revocable in the dashboard.
- **Repo detection view:** `GET /projects/:id/repos` lists matched repos by device (fingerprint, match method, last seen).
- **Manual registration fallback:** `POST /projects/:id/repos` (device auth) validated against assignment.
- **Destinations:** `POST/DELETE /projects/:id/destinations`: input URL normalized by `policy-engine`; invalid => 400; duplicate => 409.
- Every mutation writes AdminAuditEvent.

## Acceptance
Role/scope matrix; destinations/canonical repos stored canonically; lookalike inputs rejected; unassigned device cannot report fingerprints or register; cross-project access denied; fingerprint add/remove audited; a device-reported bogus fingerprint can only make its own repo more restricted.
