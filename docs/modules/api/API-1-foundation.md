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
