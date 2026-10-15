# Security review checklist

## Access control
- Every route authenticated and role-checked server-side; default deny; resource ownership/scope checked (team lead limited to own projects).
- Device credentials cannot reach admin routes; revoked devices rejected; employees cannot see others' devices/credentials/projects.
- Approver != requester; exception decisions limited to authorised roles for that project.

## Destination and policy validation
- URL normalization covers https, ssh://, scp-style, trailing `.git`, case, ports, userinfo (`github.com@evil.com`), lookalike/IDN hosts, empty/malformed input.
- Match is exact host + repo identity (no substring/endsWith/prefix).
- Parse or evaluation errors => deny/fail-safe, not allow.
- Unregistered-repo and stale/offline behavior matches the ADR.

## Git hook correctness
- Implements the real pre-push contract (args + stdin lines); handles new branch (zero remote sha), deletion (zero local sha), multiple refs, force-push, tags.
- Scans outgoing commits (rev-list range), including added-then-deleted files; not just the working tree.
- Installer preserves/chains existing hooks, is idempotent and reversible; honest about `--no-verify`/hooksPath bypass.

## Secrets and data minimisation
- No file contents/secret values in events, logs, errors, seeds or fixtures; only rule id, type, path.
- Tokens/device secrets hashed at rest; local credential files 0600; enrollment tokens short-lived, one-time.
- Logger redaction configured; no Authorization header logging.

## Exceptions
- Scope (project + destination), expiry cap, revocation enforced server-side; client claims ignored; expired approvals rejected independently of UI.

## Audit and integrity
- Policy/destination/project/exception/device/role changes emit attributable admin audit events; history append-only; events carry correlation id.
- Events do not overclaim what they prove.

## Abuse and robustness
- Input validation (Zod) on every boundary; rate limiting on auth/enrollment/ingestion; payload size limits; error responses leak nothing sensitive.
- Backend outage handling explicit; no silent fail-open.
