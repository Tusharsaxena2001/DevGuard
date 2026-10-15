# Security rules

Threat model and bypasses: `docs/architecture/security-model.md`. Review checklist: `.claude/skills/security-review/checklist.md`.

## Authorization
- Every non-public API route has an authentication guard and an explicit role/scope check server-side. Default deny.
- Roles: `employee`, `team_lead`, `project_owner`, `security_admin`. Team leads/owners act only within projects they are assigned to. Resource ownership is checked in the service layer, not just by role.
- Device credentials identify a device only; they cannot call dashboard/admin endpoints. Employees cannot read other devices' credentials or other projects' data.
- Approver must differ from requester unless a documented policy allows otherwise.

## Destinations and policy
- Normalize before comparing; compare exact host + repo identity. Reject userinfo tricks, lookalike hosts, malformed URLs, unexpected ports/schemes. Parse failure => unapproved.
- Server policy is authoritative. Exception approval is validated server-side by project + destination + expiry; client claims are ignored.
- Stale/offline behavior follows the ADR; never silently fail open.

## Data handling
- Events carry minimum metadata: rule id, secret type, file path, destination host/repo, refs, decision. Never file contents, diffs, or secret values.
- Never log secrets, passwords, tokens, Authorization headers, enrollment tokens. Use logger redaction. Hash device secrets and enrollment tokens at rest (store only hashes); local credential files mode 0600.
- Test fixtures and seed data are synthetic; build secret-looking strings at runtime so scanners/repos never contain them literally.

## Audit
- Policy, destination, project, exception, device and role changes write an `AdminAuditEvent` (actor, action, target, before/after summary, timestamp). Audit history is append-only; no update/delete endpoints.
- Do not claim an event proves more than the evidence shows (an event says the hook observed a push attempt, not that data was or was not exfiltrated).

## Honesty
Local hooks can be removed or bypassed (`--no-verify`, deleting the hook, `core.hooksPath`, other Git clients). Document, don't hide. Never describe the minimal secret detector as comprehensive.
