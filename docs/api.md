# API reference

Overview of the HTTP surface of `apps/api`. Request and response shapes are the Zod schemas in `packages/shared`; outside production the live OpenAPI UI is served at `/docs`. Everything except `/health` is under `/v1`.

## Authentication

| Principal | How it authenticates | Where it is accepted |
|---|---|---|
| User (dashboard) | `dg_session` cookie (httpOnly JWT) set by `POST /v1/auth/login` | Routes marked **user** or **admin** |
| Device (agent) | `Authorization: Bearer <device credential>` issued at enrollment | Routes marked **device** only |
| None | - | Routes marked **public** |

Default deny: a route without `@Public()` requires an authenticated principal. **admin** routes additionally require the `security_admin` role, checked by a global role guard. Device credentials cannot call user or admin routes, and sessions cannot call device routes. Per-user data (devices, exception requests, events) is also scoped in the service layer. Roles are global in the MVP (ADR-014).

## Routes

### Health and auth
| Method | Path | Access |
|---|---|---|
| GET | `/health` | public |
| POST | `/v1/auth/login` | public, strictly rate limited |
| POST | `/v1/auth/logout` | public (clears the cookie) |
| GET | `/v1/auth/me` | user |

### Users, projects, protection setup (admin)
| Method | Path | Purpose |
|---|---|---|
| GET, POST | `/v1/users` | list, create users |
| GET, POST | `/v1/projects` | list, create projects |
| GET, PATCH | `/v1/projects/:id` | read, update a project |
| PUT | `/v1/projects/:id/members` | assign employees |
| GET, POST, DELETE | `/v1/projects/:projectId/destinations[/:id]` | approved destinations |
| GET, POST, DELETE | `/v1/projects/:projectId/canonical-repos[/:id]` | canonical repositories |
| GET, POST, DELETE | `/v1/projects/:projectId/fingerprints[/:id]` | root-commit fingerprints |
| GET | `/v1/projects/:projectId/repos` | repos matched to the project |
| GET, PUT | `/v1/projects/:projectId/policy` | read, replace the project policy |
| GET | `/v1/projects/:projectId/policy/versions` | policy version history |

### Devices
| Method | Path | Access |
|---|---|---|
| POST | `/v1/devices/enrollment-tokens` | admin |
| POST | `/v1/devices/enroll` | public, strictly rate limited (consumes a one-time token) |
| POST | `/v1/devices/heartbeat` | device |
| GET | `/v1/devices`, `/v1/devices/:id` | user (own devices) or admin |
| POST | `/v1/devices/:id/revoke` | admin |

### Events, exceptions, audit, metrics
| Method | Path | Access |
|---|---|---|
| POST | `/v1/agent/events` | device (metadata only: rule id, kind, path, commit, line; no contents) |
| GET | `/v1/events`, `/v1/events/:id` | user (own events) or admin |
| POST, GET | `/v1/exceptions`, `/v1/exceptions/:id` | user (own requests) or admin |
| POST | `/v1/exceptions/:id/approve`, `/reject`, `/revoke` | admin (approver must differ from requester) |
| POST, GET | `/v1/agent/exceptions`, `/v1/agent/exceptions/:id` | device (request and track exceptions) |
| POST | `/v1/agent/exceptions/validate` | device (server checks scope and expiry) |
| GET | `/v1/audit` | admin (append-only audit history) |
| GET | `/v1/metrics/summary` | admin |

### Agent sync
| Method | Path | Access |
|---|---|---|
| GET | `/v1/agent/projects` | device (assigned projects and cached policy) |
| POST | `/v1/agent/repo-fingerprints` | device |
| POST | `/v1/projects/:projectId/repos` | device (report a matched repo) |

## Errors
Errors use a stable `code` string and a message that never contains secrets, tokens or file contents. Validation failures are rejected at the boundary; unknown paths return a JSON 404.
