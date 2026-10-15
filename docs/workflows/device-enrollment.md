# Workflow: device enrollment, assignment and revocation

Developer involvement is a one-time install + enroll. Everything else is configured in the dashboard (ADR-008).

1. Admin/lead (dashboard) creates/assigns projects and issues an enrollment token for an employee. Token: random, one-time, short-lived, stored hashed, never logged.
2. On the laptop: install the agent, run `devguard enroll --server <url> --token <token>`. Agent sends token + device metadata (hostname, OS, agent version).
3. API validates (unused, unexpired, rate-limited), creates the Device, returns a per-device secret once. Agent writes `~/.config/devguard/credentials.json` mode 0600.
4. Enroll also runs `devguard install --global` (global hooks path, existing global value preserved).
5. Agent syncs assigned projects; repos are matched automatically (AG-4). No per-repo steps.
6. Heartbeats with sync update `lastSeenAt` and report hook status (including repo-level overrides).
7. Assignment changes in the dashboard apply at the next sync. Revocation: admin revokes the device; calls get 401; protected repos fall back to cached-policy rules (ADR-004).

## Failure cases
Expired/used token => generic error, audit event. Revoked device => 401, no data. Credentials file with wrong permissions => agent warns and refuses to use it. Duplicate enrollment => new device record, old unaffected. Existing global `core.hooksPath` => preserved and chained, restored on uninstall.
