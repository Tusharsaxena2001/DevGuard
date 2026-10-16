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

## Implemented (apps/api)
- **Scope (ADR-014):** every dashboard route is admin-only; there are no owner/lead-scoped lists. Assignment = an `employee` membership with a `projectId`.
- **Routes** (`/v1`): `GET/POST /projects`, `GET/PATCH /projects/:id`, `PUT /projects/:id/members` (replaces the set; ids must be existing active users, else 400); `GET/POST /projects/:id/destinations`, `DELETE .../destinations/:id`; `GET/POST /projects/:id/canonical-repos`, `DELETE .../canonical-repos/:id`; `GET/POST /projects/:id/fingerprints`, `DELETE .../fingerprints/:id`; `GET /projects/:id/repos` (admin) and `POST /projects/:id/repos` (device: register a repo fingerprint to an assigned project); `POST /agent/repo-fingerprints` (device).
- **Creating a project** also creates its `Policy` and version 1 (enforce, `DEFAULT_PROHIBITED_GLOBS`, `DEFAULT_SECRET_RULE_IDS`) in the same transaction, so every project always has a policy to sync.
- **Normalization:** destination and canonical-repo URLs go through `normalizeDestination` (policy-engine). A rejected URL is a 400 whose only detail is `{path:"url", code:<reason>}`. Stored as `exact` (the `owner_wildcard` type exists in the schema and matcher but there is no API to create it yet). Canonical repos are implicitly approved destinations: sync lists them in `policy.destinations` too (deduplicated).
- **Device fingerprint reports** (ADR-008): accepted only if the device owner is assigned to the project **and** the normalized remote matches one of the project's canonical repos / approved destinations (`isApproved`, exact host + path). Unassigned/unknown project => 403 (same answer, so ids cannot be probed). A report can only make the reporter's own repo count as that project (stricter). Idempotent; only the first report is audited (`fingerprint.reported`, with `deviceId`). Admins can list (with `source` and `reportedByDeviceId`) and remove any fingerprint.
- **Deletes are project-scoped:** an id belonging to another project is 404.
- **Audit** (same transaction): `project.created/updated/members_changed`, `destination.added/removed`, `canonical_repo.added/removed`, `fingerprint.added/reported/removed`, `repo.registered`.
- **Schema:** new `CanonicalRepo` and `ProjectFingerprint` (migration `canonical_repos_and_fingerprints`); `RepoRegistration` is used for manual device registration.
- **Contracts:** `packages/shared/src/projects.ts`.
- **Known gaps:** no team/group assignment (individual employees only); no owner/lead scoping (ADR-014); `owner_wildcard` destinations cannot be created through the API; a project cannot be deleted (history must stay); the agent's own `devguard register` is still local-only and does not call `POST /projects/:id/repos` yet.
- **Security review (API-3/API-4):** independent read-only review found no critical/high issues. Fixed: a per-project cap of 1000 fingerprints (matches the sync contract; past it manual adds and device reports are 409), stable ordering so the sync ETag does not flap. Accepted and documented: the `remote` in a device fingerprint report is a client claim (it proves the remote is in the project's allowlist, not that the repo has it), so a member can make an unrelated colleague repo with the same root commit count as the project (a nuisance block, never a bypass; reports are attributed in `reportedByDeviceId` and removable by an admin); audit rows for device reports carry the device owner as `actorId` and the `deviceId` in the summary (they are not user actions). Device-report routes have only the global throttle.

