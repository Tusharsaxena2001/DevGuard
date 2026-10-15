# AG-6 Policy sync and offline cache (apps/agent)

**Responsibility:** fetch all projects assigned to the enrolled employee (policy, destinations, canonical repos, fingerprints) via `GET /agent/projects`, cache them, apply ADR-004. Feeds AG-4 resolution (ADR-008). Also uploads newly learned repo fingerprints.
**Depends on:** AG-5, API-4.

## Contract
- `devguard sync` and implicit sync at push time (short timeout). Cache `{policy, version, fetchedAt}` per project. ETag/version to skip unchanged.
- `loadEffectivePolicy(project, now)` => `{policy, freshness: fresh|stale_ok|expired|missing}`; expired/missing => caller applies ADR-004 (enforce block / audit-only allow+record).
## Acceptance
Fresh, stale-within-TTL, beyond-TTL (enforce vs audit-only), missing cache, server version bump picked up, corrupted cache file => treated as missing.
