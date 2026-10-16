# SH-1 Shared contracts (packages/shared)

**Responsibility:** single source of truth for data shapes used by agent, API and dashboard. Zod schemas + inferred types. No runtime logic beyond validation helpers.
**Depends on:** none.

## Contract
- Enums: `Role` (employee, team_lead, project_owner, security_admin), `Classification` (internal, confidential, client_owned), `EnforcementMode` (enforce, audit_only), `Outcome` (allowed, blocked, error, exception), `ExceptionStatus`, `DeviceStatus`, `OperationType` (push, force_push, branch_delete, ...).
- Schemas: `NormalizedDestination {host, repoPath}`, `ProjectPolicy {version, mode, classification, destinations[], prohibitedGlobs[], secretRules[]}`, `OutgoingChangeSummary {refs[], commits[], files[]}` (paths + change type only, no content), `Decision {outcome, ruleId, reasons[], findings[]}`, `Finding {ruleId, kind, path, commit?}` (no matched text), `SecurityEventInput`, `ExceptionRequestInput`, `ExceptionValidationResult`, API DTOs.
- Error codes: stable string enum.

## Implemented (packages/shared/src)
`enums.ts` (roles, classification, mode, outcome, operation, device/exception status, `RuleId`), `common.ts` (`GitSha`, `NormalizedDestination`), `findings.ts` (`Finding`, `RefUpdate`, `ChangedFile`, `OutgoingChangeSummary`), `policy.ts` (`ProjectPolicy`, `ApprovedDestination`, `AgentProject`, `AgentProjectSync`), `decision.ts`, `events.ts` (`SecurityEventInput`, batch), `exceptions.ts` (request/decision inputs, `ValidException`, validation result), `errors.ts` (`ErrorCode`), `auth.ts` and `devices.ts` (API-2: login/session/user and enrollment/device/heartbeat DTOs plus `formatDeviceCredential`/`parseDeviceCredential`). Consumers import from `@devguard/shared` (built to `dist/`; run `pnpm --filter @devguard/shared build` after changes). Event bodies carry no identity fields: the server derives device/employee from the credential.

## Security invariants
`Finding` and `SecurityEventInput` have no field capable of carrying file contents or secret values; schemas are `.strict()`.

## Acceptance
- Package builds; schemas export inferred types; strict schemas reject unknown fields; roles/enums stable.
## Tests
Schema parse accept/reject tables; strictness (extra content field rejected); enum exhaustiveness.
## Failure behavior
Parse errors return structured issues; never include rejected raw values > path in messages.
