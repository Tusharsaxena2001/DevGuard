# API-2 Auth, RBAC and device identity (apps/api)

**Responsibility:** authenticate users and devices; enforce roles and scope server-side.
**Depends on:** API-1.

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
