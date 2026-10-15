# ADR-006: Authentication of devices and dashboard users

**Status:** accepted
**Decision:**
- Dashboard users: email + password (argon2id), short-lived JWT in an httpOnly, SameSite cookie, login rate-limited, generic failure messages.
- Devices: security admin (or lead for their scope) issues a one-time, short-lived enrollment token bound to an employee. `devguard enroll` exchanges it for a per-device secret. Server stores only a hash; agent stores the secret in `~/.config/devguard` with mode 0600 (OS keychain is a post-MVP improvement). Device secrets are revocable and can only call agent endpoints (policy sync, event ingest, exception request/status).
**Why:** least privilege, revocation, no shared credentials, simple to implement and test.
**Consequences:** local file storage is readable by the same OS user; documented limitation.
