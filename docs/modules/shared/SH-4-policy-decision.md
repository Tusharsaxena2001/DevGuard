# SH-4 Policy engine — decision (packages/policy-engine)

**Responsibility:** combine destination, content, mode and exceptions into one deterministic `Decision`.
**Depends on:** SH-2, SH-3.

## Contract
`evaluatePush(input: {projectId, protected, policy, destinationRaw, content: Finding[], exceptions: ValidException[], now: Date}): Decision` (`projectId` added for exception scope; `change` dropped: the caller turns the outgoing change into `content` findings via SH-3, so the decision never reads it)
- Not protected => `allowed`, ruleId `unprotected_repo`.
- Destination unapproved (or unparsable) => violation `destination_not_approved`, unless a valid exception matches project + normalized destination and `now < expiresAt` and status approved => outcome `exception` (content findings still apply unless exception lists the rule id, ADR-007).
- Content findings => violations `prohibited_file` / `secret_detected`.
- Mode: `enforce` + violation => `blocked`; `audit_only` + violation => `allowed` with `wouldBlock: true`.
- Conflicts: most restrictive rule wins; ordering is deterministic; all violations reported.
- Exceptions: `validateException(exc, {projectId, destination, now}): Result<ValidException, ExceptionRejection>` independent function reusable by API.
- Any thrown/invalid state => `error` outcome treated as block in enforce.
## Implemented semantics (packages/policy-engine/src/decision)
- Files: `exception.ts` (`validateException`), `evaluate.ts` (`evaluatePush`). Never throws; never mutates input.
- **`validateException`** requires: status `approved`; same `projectId`; exact host + repoPath equality (no prefix/suffix); approver != requester (`self_approved`); `now` strictly before `expiresAt`. Rejection reasons: `not_approved | wrong_project | wrong_destination | self_approved | invalid_time | expired`. Unparsable `expiresAt` or invalid `now` => `invalid_time` (never valid by accident).
- **Order of evaluation:** unprotected => `allowed`/`unprotected_repo` (policy not inspected). Otherwise the policy is Zod-validated and `now` checked; failure => `error`.
- **Violations** (all reported in `violatedRuleIds`, fixed priority, first = primary `ruleId`): `destination_not_approved`, `secret_detected`, `prohibited_file`, `scan_error`. Priority does not depend on mode or input order. Content `kind` maps secret -> `secret_detected`, prohibited_file -> `prohibited_file`, scan_error -> `scan_error`.
- **Exception selection:** among valid exceptions for (project, normalized destination, now) the longest-lived wins, ties by lowest id. An exception waives `destination_not_approved`, plus `prohibited_file` / `secret_detected` only if listed in `waivedRuleIds`. `scan_error`, `internal_error` and unknown ids are never waivable. A listed content waiver also applies when the destination is already approved. An unparsable destination can never match an exception.
- **Outcomes:** remaining violations + `enforce` => `blocked`; + `audit_only` => `allowed`, `wouldBlock: true`; no remaining violations but something waived => `exception`/`exception_granted` with `exceptionId`; else `allowed`/`allowed`.
- **Errors:** invalid policy, invalid `now` or any thrown error => `outcome: "error"`, `ruleId: "internal_error"`, `wouldBlock: true`. The mode may be unknowable, so the **caller (AG-3)** decides: `error` blocks in enforce, and with a known audit-only mode allows with a local record (ADR-004).
- **Data handling:** reasons are generic counts/sentences. They never contain the raw destination (may hold credentials), paths, or secret values. Findings are passed through as evidence, capped at 10,000 (with a reason when truncated).
- **Boundary validation:** `content` is validated with `FindingSchema` (strict); an invalid or unknown-kind finding => `error` (never a silent pass), and extra fields are rejected so nothing unexpected reaches the decision. Each exception is validated with `ValidExceptionSchema`; a malformed one is treated as absent. `expiresAt` must be strict ISO-8601 with `Z`.
- **Caller responsibility:** `projectId` is trusted: `ProjectPolicy` carries no id, so the agent/API must pass a matching (projectId, policy) pair.
- **Offline:** exceptions cannot be validated offline (ADR-004), so the caller passes `exceptions: []`.
## Acceptance
Matrix tests (mode × violation × exception state × protected); expiry boundary (`now === expiresAt` => expired); no mutation of inputs; same input => same output.
**Verified:** 108 tests in `decision/` (417 in the policy-engine package; 37 in shared), covering the matrix, rejection precedence, boundary validation, destination tricks, truncation boundary, wall-clock independence and Decision-contract conformance. Mutation-checked (expiry boundary, self-approval, project/destination scope, status, waivable set, mode handling, `wouldBlock`, exception ordering, protected guard, strict expiry parsing, malformed-exception skip, truncation boundary); one equivalent mutant (explicit invalid-content check, redundant with the outer try/catch). Independent security and test reviews done; findings fixed or pinned. Pinned behaviours: only the single selected exception applies (waivers are not unioned); identical empty approver/requester ids count as self-approved.
