# API-4 Policies (apps/api)

**Responsibility:** versioned project policies; authoritative sync for agents.
**Depends on:** API-3.

## Contract
- `GET /projects/:id/policy` (user), `PUT /projects/:id/policy` (owner/admin; body validated by SH-1 `ProjectPolicy` input; optimistic `baseVersion`, 409 on conflict) -> creates immutable PolicyVersion + audit event.
- `GET /projects/:id/policy/versions` history.
- `GET /agent/projects` (device auth, ETag/If-None-Match): returns **every project assigned to the device's user**: policy (version, mode, classification, prohibited globs, secret rules), approved destinations, canonical repos, and repo fingerprints. This is the single sync payload the agent caches (ADR-008).
## Acceptance
Version increments, immutability, conflict handling, device receives only its user's assigned projects (assignment change takes effect at next sync; removal drops the project), revoked device gets nothing, ETag 304, audit entries with before/after summary.

## Implemented (apps/api)
- **Routes** (`/v1`): `GET /projects/:id/policy` (current `ProjectPolicy`: version, mode, classification, destinations, prohibited globs, secret rule ids), `PUT /projects/:id/policy` (body `PolicyUpdateRequest {baseVersion, mode, prohibitedGlobs, secretRules}`), `GET /projects/:id/policy/versions` (newest first). All admin-only (ADR-014).
- **Versioning:** each PUT appends version `baseVersion + 1` in one transaction; versions are immutable (DB trigger, tested with a direct update). A stale `baseVersion` is 409 `conflict`; two concurrent edits from the same base produce exactly one winner (unique `(projectId, version)` is caught and reported as 409; this was a real 500 found by the concurrency test). Unknown secret rule ids are 400 (known ids = policy-engine `SECRET_RULES`). Destinations are managed separately (API-3) and are not part of a version; the ETag still changes when they do.
- **`GET /agent/projects`** (device credential only): every project assigned to the device owner as `AgentProjectSync` (SH-1): per project the policy (with destinations = approved destinations ∪ canonical repos), canonical repos and fingerprints. `ETag` is a hash of the projects (not `syncedAt`); `If-None-Match` with the same value gets 304. Unassigned => empty list; assignment removal drops the project at the next sync; a revoked device gets 401 `device_revoked`; a project without a policy version is not synced (the agent treats an unknown project as unprotected per ADR-003, so a missing policy can never be mistaken for a permissive one).
- **Audit:** `policy.updated` with `fromVersion/toVersion`, before/after mode and counts of globs and secret rules (no rule contents beyond counts).
- **Tests:** `test/policies.e2e.test.ts`, `test/agent-sync.e2e.test.ts` (contract parse with the shared schema, ETag/304, assignment changes, revoked device, no credentials in payload, fingerprint reports).
- **Known gaps:** the ETag is computed after assembling the payload (saves bandwidth, not server work); no pagination (sync is capped by the contract: 1000 projects, 1000 fingerprints each).

