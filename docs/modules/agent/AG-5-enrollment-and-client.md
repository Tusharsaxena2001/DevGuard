# AG-5 Enrollment and API client (apps/agent)

**Responsibility:** enroll device, authenticated HTTP client for device endpoints.
**Depends on:** AG-1, API-2.

## Contract
- `devguard enroll --server <url> --token <t>`: POST enrollment; store device id + secret (0600). Token never echoed or logged.
- Client: bearer device secret, timeouts, bounded retries with backoff, typed errors (`revoked`, `unauthorized`, `unreachable`), Zod-validated responses. HTTPS required except `localhost`.
- `devguard status` shows enrollment state and last successful contact.
## Acceptance
Enroll success/failure (expired, reused token), revoked device handling, secret file permissions, no secrets in logs (assert on captured output).
