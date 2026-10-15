# API-4 Policies (apps/api)

**Responsibility:** versioned project policies; authoritative sync for agents.
**Depends on:** API-3.

## Contract
- `GET /projects/:id/policy` (user), `PUT /projects/:id/policy` (owner/admin; body validated by SH-1 `ProjectPolicy` input; optimistic `baseVersion`, 409 on conflict) -> creates immutable PolicyVersion + audit event.
- `GET /projects/:id/policy/versions` history.
- `GET /agent/projects` (device auth, ETag/If-None-Match): returns **every project assigned to the device's user**: policy (version, mode, classification, prohibited globs, secret rules), approved destinations, canonical repos, and repo fingerprints. This is the single sync payload the agent caches (ADR-008).
## Acceptance
Version increments, immutability, conflict handling, device receives only its user's assigned projects (assignment change takes effect at next sync; removal drops the project), revoked device gets nothing, ETag 304, audit entries with before/after summary.
