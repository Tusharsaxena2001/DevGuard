# AG-5 Enrollment and API client (apps/agent)

**Responsibility:** enroll device, authenticated HTTP client for device endpoints.
**Depends on:** AG-1, API-2.

## Contract
- `devguard enroll --server <url> --token <t>`: POST enrollment; store device id + secret (0600). Token never echoed or logged.
- Client: bearer device secret, timeouts, bounded retries with backoff, typed errors (`revoked`, `unauthorized`, `unreachable`), Zod-validated responses. HTTPS required except `localhost`.
- `devguard status` shows enrollment state and last successful contact.
## Acceptance
Enroll success/failure (expired, reused token), revoked device handling, secret file permissions, no secrets in logs (assert on captured output).

## Implemented (apps/agent)
- **Commands:** `devguard enroll --server <url> (--token <t> | --token-stdin)`; `devguard status [--check-server]`. `--token` is visible in the process list and shell history (help text says so); `--token-stdin` avoids both. Exactly one is required.
- **Enroll flow** (`use-cases/enroll-device.ts`): validate server URL and token shape locally, call `POST /v1/devices/enroll`, and only if the server accepts, write `credentials.json` (0600) then `config.json`, then install the global hook (workflow step 4). A failed hook install leaves the enrollment saved, prints "NOT installed", exit 2. A failed local write after the server created the device explains how to recover (admin revokes that device id). Re-enrolling replaces the local enrollment and says the old device record stays on the server until revoked. The token and secret are never printed, in `--json` or in errors.
- **API client** (`adapters/http-api-client.ts`, port `ports/api-client.ts`): https only (http only for localhost/127.0.0.1/[::1]; no userinfo, query or fragment, including empty `?`/`#`), re-checked on every call; `redirect: "error"` so the secret never follows a redirect; 10 s timeout; 1 MiB response cap (declared and actual); success bodies parsed with shared Zod schemas; failures reduce to typed kinds (`unreachable`, `unauthorized`, `revoked`, `token_invalid`, `rate_limited`, `server_error`, `rejected`, `invalid_response`, `invalid_server_url`), never server text. Only idempotent calls retry (heartbeat: 3 attempts, exponential backoff, on network errors and 502/503/504); enrollment never retries because the token is single use. Bearer = `<deviceId>.<secret>` via `formatDeviceCredential`.
- **Status:** shows enrollment state from local files and `Last server contact` (`config.json.lastContactAt`, set at enrollment and on each successful heartbeat; informational only). `status --check-server` sends a heartbeat and reports reachable / unauthorized / revoked / unreachable (exit 2 on failure; "not enrolled" is not a failure). A revoked device is told so explicitly. Plain `status` makes no network call.
- **Shared:** `loadEnrollment(store)` (config + credentials must agree on the device id; anything else is `unusable`/`not_enrolled`) is the entry point AG-6/7/8 use to get server + credentials.
- **Tests:** HTTP client against a real local server (redirect, timeout, retry/backoff, size, URL tricks, header format), enroll/check-server use cases with fakes (including partial failure and no-secret-in-output), CLI behaviour, plus a manual end-to-end run of the built CLI against the real API and Postgres (enroll, token reuse rejected, 0600 files, revoke -> "revoked").
- **Security review:** independent read-only review found no high/critical issues; fixed: empty `?`/`#` accepted in server URL, response-secret length now bounded to match the credential file, declared-size check before reading the body, token-may-be-used hint after an unreachable enroll, `--token` visibility documented.
- **Known gaps:** `status --check-server` exits 2 for every failure kind (scripts cannot tell revoked from offline); a concurrent heartbeat and re-enroll could rewrite `config.json` (fails safe: ids mismatch, treated unusable); the device secret sits in a user-readable file (ADR-006); `localhost` is trusted without resolving it.

