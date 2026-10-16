# ADR-014: MVP authorization scope (admin / employee / device, no project-scoped roles)

**Status:** accepted
**Context:** API-2. DevGuard is a safety net against mistaken pushes, controlled from a dashboard that records everything. The current goal is a hackathon idea validation, not a multi-team deployment. The full role model (team leads and project owners acting only inside their projects) is the most expensive part of API-2 and is not needed to prove the idea.

## Decision
- Three kinds of principal: **security admin** (global `security_admin` membership), **employee** (any other active user) and **device** (per-device secret). Device and user credentials never substitute for each other.
- `@Roles()` is enforced server-side by a global `RolesGuard`, and only **global** memberships count. Project-scoped memberships exist in the schema but are not evaluated.
- Admins manage users, enrollment tokens and device revocation; employees see only their own devices. There is no `PUT /users/:id/roles`; roles come from the seed or from `POST /users` (`isAdmin`).
- Enrollment tokens are issued by admins only.
- Deferred: lead/owner scoping, `ProjectScopeService`, role-management endpoints, cross-project tests. The schema needs no migration to add them later.

## Kept regardless of this cut
Authentication on every non-public route (default deny), backend enforcement (UI hiding is never access control), hashed credentials, revocation, rate limits, and an attributable audit row for user, token, enrollment and revocation changes (invariant 9). Approver must differ from requester for exceptions (API-6); the seed has two admins so this is testable.

## Related choices made in API-2
- **Passwords:** argon2id (`@node-rs/argon2`). Unknown email, wrong password and disabled account give one generic 401, and an unknown email still pays for a verification (no timing signal).
- **Sessions:** HS256 JWT (`jose`) in an httpOnly, `SameSite=Lax` cookie (`Secure` in production). Status and roles are re-read from the database on every request, so disabling a user takes effect immediately. Logout clears the cookie; the JWT itself stays valid until expiry (stateless), which the per-request status check bounds for disabled users only.
- **CSRF:** `SameSite=Lax` plus CORS limited to the dashboard origin. No separate CSRF token in the MVP.
- **Device credential:** `Authorization: Bearer <deviceId>.<secret>`; the id selects the row, SHA-256 of the secret is compared in constant time (secrets are 256-bit random, so a fast hash is sufficient). A wrong secret and an unknown device both answer `unauthenticated`; `device_revoked` (HTTP 401) is only shown to a caller holding the right secret.
- **Enrollment tokens:** 256-bit random, stored as SHA-256, single use enforced by one conditional `UPDATE ... WHERE usedAt IS NULL AND expiresAt > now`, so concurrent use yields exactly one device. All failures return the same error.
- **Versioning:** routes live under `/v1` via the controller path (not `setGlobalPrefix`, which would scope Nest's JSON 404 handler to `/v1` only). `/health` is unversioned.

## Consequences
- Honest limit: any admin can do everything; there is no separation between teams. Not suitable for a multi-team rollout without the deferred work.
- Failed enrollments are not audited (the audit table requires an actor and there is none); they are rate limited and answered uniformly.
