# API-1 Foundation (apps/api)

**Responsibility:** NestJS skeleton, Prisma schema, migrations, seed, config, OpenAPI, logging, rate limiting.
**Depends on:** SH-1.

## Schema (Prisma, PostgreSQL)
| Model | Key fields / constraints |
|-------|--------------------------|
| User | id, email (unique), passwordHash, name, status, createdAt |
| Membership | userId, role, projectId? (null = global), unique(userId, role, projectId) |
| Device | id, userId, name, os, agentVersion, secretHash, status (active/revoked), enrolledAt, lastSeenAt, revokedAt |
| EnrollmentToken | id, userId, tokenHash (unique), expiresAt, usedAt, createdBy |
| Project | id, name (unique), classification, ownerId, createdAt |
| RepoRegistration | id, projectId, deviceId, repoFingerprint, registeredAt; unique(deviceId, repoFingerprint) |
| ApprovedDestination | id, projectId, host, repoPath, type(exact/owner_wildcard), createdBy; unique(projectId, host, repoPath) |
| Policy / PolicyVersion | projectId, version (monotonic), mode, prohibitedGlobs, secretRules, createdBy, createdAt (versions immutable) |
| ExceptionRequest / ExceptionDecision | see API-6 |
| SecurityEvent | id, occurredAt, deviceId, userId, projectId?, destHost, destRepo, operation, ruleIds[], mode, outcome, correlationId (indexed), policyVersion, exceptionId?, approverId? ; indexes (projectId, occurredAt), (deviceId, occurredAt), (outcome) |
| AdminAuditEvent | id, occurredAt, actorId, action, targetType, targetId, summary (JSON, redacted); no update/delete |
No column stores credentials in plaintext, file contents or secret values.

## Cross-cutting
Zod validation pipe; global exception filter (no stack/secrets); pino logger with redaction (authorization, cookie, token, password, secret); throttler; helmet; CORS limited to dashboard origin; OpenAPI at `/docs`; `/health`.
## Structure (docs/architecture/engineering-standards.md)
`src/modules/<feature>/{controller,service,repository,mapper,module}`, `src/common/`, `src/prisma/`, `src/config/` (Zod-validated env). Controllers never import Prisma; services never import other modules' repositories. ESLint boundary rules defined in this module. Alerts add models in API-8 (Notification, Delivery, ProjectAlertChannel, NotificationPreference).
## Seed
Idempotent, synthetic only (one security_admin, lead, two employees, sample projects/destinations/events); credentials from env/random printed once in dev, never committed.
## Acceptance
Clean DB: `migrate deploy` + `seed` work; seed twice is safe; app boots; `/health` OK; OpenAPI served.

## Implemented (apps/api)
- **Stack notes:** NestJS 12 (ESM, `experimentalDecorators`, explicit `@Inject()` everywhere: no decorator metadata), Prisma 7 with the `pg` driver adapter (`prisma.config.ts`; client generated into `src/prisma/generated`, gitignored, built by `pretypecheck/prebuild/pretest`). See ADR-013.
- **Schema:** all models in the table above except alerts (API-8). `ExceptionRequest`/`ExceptionDecision` carry the minimum columns API-6 needs; API-6 may extend them. Two migrations: `init`, and `block_truncate_on_append_only`.
- **DB-enforced invariants:** partial unique index for global memberships (NULL `projectId`); `PolicyVersion` immutable and `AdminAuditEvent` append-only (BEFORE UPDATE/DELETE/TRUNCATE triggers); `unique(projectId, version)`.
- **Cross-cutting:** `src/config/env.ts` (Zod; problems name variables only), `ApiError` + `httpStatusFor` (`src/errors.ts`), `AllExceptionsFilter`, `ZodValidationPipe` (path + code only), pino redaction (`logger-options.ts`), throttler (`THROTTLE_LIMIT`/`THROTTLE_TTL_SECONDS`), helmet, CORS answers only for the dashboard origin, OpenAPI at `/docs` and `/docs-json` (not served when `NODE_ENV=production`).
- **Routes:** `GET /health` (public; `{status:"ok"}`, or 503 `{status:"degraded"}` when the DB is unreachable, no details). Startup fails if the database is unreachable.
- **Seed:** `prisma/seed/seed.ts` (+ `prisma/seed.ts` entry), idempotent. Users carry the non-loginable placeholder `!seed-no-login` and the device `!seed-no-device-secret`; there are no passwords to print. API-2 sets real hashes (argon2id).
- **Boundaries:** ESLint rules in the root `eslint.config.js` (controllers: no Prisma/repositories; services: no Prisma or other modules' repositories; Prisma only in `*.repository.ts` and `src/prisma`), proven by `test/boundaries.test.ts`.
- **Tests:** `src/**/*.test.ts` (unit) and `test/*` (integration/e2e against a dedicated `devguard_test` database that `test/global-setup.ts` drops, creates and migrates; refuses non-local hosts).
- **Known gaps / next:** no auth yet (API-2: every route is public, only `/health` and `/docs` exist); no `AuditService` (API-7); the DB owner can still bypass the triggers (documented in ADR-013); `/docs` rendering in a browser was not checked (HTTP 200 only).
