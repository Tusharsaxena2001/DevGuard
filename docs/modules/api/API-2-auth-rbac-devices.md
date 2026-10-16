# API-2 Auth, RBAC and device identity (apps/api)

**Responsibility:** authenticate users and devices; enforce roles and scope server-side.
**Depends on:** API-1.
**Scope note:** project-scoped RBAC is deferred for the hackathon MVP (ADR-014). Only global `security_admin` vs other users vs devices is enforced.

## Contract (REST, `/v1`)
- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` (cookie JWT, rate-limited, generic errors).
- `POST /devices/enrollment-tokens` (lead in scope / admin): one-time token, TTL from env, returned once.
- `POST /devices/enroll` (public, rate-limited): token + metadata -> device id + secret (once).
- `GET /devices` (scoped), `GET /devices/:id`, `POST /devices/:id/revoke` (admin), `POST /devices/heartbeat` (device auth, updates lastSeenAt).
- Users/roles: `GET/POST /users`, `PUT /users/:id/roles` (admin).
## Guards
`AuthGuard` (user JWT), `DeviceAuthGuard` (device secret, hashed compare, status active), `RolesGuard` with `@Roles()`, `ProjectScopeGuard/service` verifying membership for project-bound resources. Device principals cannot satisfy user guards and vice versa.
## Acceptance / tests
Unauthenticated 401; wrong role 403; cross-project 403/404; employee cannot read other devices; revoked device 401; expired/used token rejected; secrets/hashes never returned or logged; rate limit triggers.

## Implemented (apps/api)
- **Scope (ADR-014):** admin / employee / device only. Not implemented: `PUT /users/:id/roles`, lead-issued tokens, `ProjectScopeGuard`, project-scoped role checks.
- **Routes** (under `/v1`, `/health` unversioned): `POST /auth/login` (public, strict throttle), `POST /auth/logout` (public, clears cookie), `GET /auth/me`; `GET/POST /users` (admin; `POST` body `{email,name,password,isAdmin?}`); `POST /devices/enrollment-tokens` (admin, body `{userId}`), `POST /devices/enroll` (public, strict throttle), `POST /devices/heartbeat` (device), `GET /devices` (admin: all; others: own), `GET /devices/:id` (admin or owner, else 404), `POST /devices/:id/revoke` (admin, idempotent).
- **Guards** (global, in order): `ThrottlerGuard`, `AuthGuard` (default deny; `@Public()`, `@DeviceAuth()`, else session cookie), `RolesGuard` (`@Roles()`, global memberships only). Principals: `UserPrincipal` / `DevicePrincipal` (`common/auth`).
- **Contracts** added to `packages/shared`: `auth.ts` (`LoginRequest`, `SessionUser`, `CreateUserRequest`, `UserSummary`), `devices.ts` (`CreateEnrollmentTokenRequest`, `EnrollmentTokenResponse`, `EnrollRequest`, `EnrollResponse`, `HeartbeatRequest`, `DeviceSummary`, `formatDeviceCredential`/`parseDeviceCredential`).
- **Device credential:** `Authorization: Bearer <deviceId>.<secret>` (use `formatDeviceCredential`). Revoked device => HTTP 401 with code `device_revoked` (the spec's "revoked device 401"; `httpStatusFor` updated from 403).
- **Audit** (same transaction, via `prisma/audit-write.ts`): `user.created`, `device.enrollment_token_issued`, `device.enrolled`, `device.revoked`. Summaries hold ids/names only, never tokens or secrets. `AuditService` reads/metrics remain API-7.
- **Env:** `AUTH_THROTTLE_LIMIT` (default 10 per window for login and enroll).
- **Seed:** `pnpm --filter @devguard/api seed` hashes `SEED_PASSWORD` (or a random password printed once) onto users still holding the placeholder; adds `admin2@example.test` as a second admin. Seed devices keep a non-usable secret.
- **Tests:** `test/auth.e2e.test.ts`, `users.e2e.test.ts`, `devices.e2e.test.ts` (real Postgres; includes token race, revoked device, principal separation, default-deny route sweep), plus unit tests for crypto, cookies and redaction.
- **Security review:** independent read-only review found no critical/high issues; fixed: decoy hash warmed at start and used for seed placeholders (timing), enroll re-checks owner status, seed refuses `NODE_ENV=production`, throttle-before-auth ordering proven by test.
- **Known gaps:** failed enrollments are not audited (no actor); logout does not invalidate an unexpired JWT; no refresh tokens or password reset; device secrets live in a user-readable file on the laptop (ADR-006); no per-account lockout (IP-based throttle only). Throttling is per IP and `trust proxy` is not configured (behind a reverse proxy all clients would share a bucket; set it for the deployment topology); `/docs` is served whenever `NODE_ENV` is not `production`; CSRF relies on `SameSite=Lax` + CORS allowlist (no Origin check).
