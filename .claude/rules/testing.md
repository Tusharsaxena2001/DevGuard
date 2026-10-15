# Testing rules

Tooling: Vitest for packages/agent/dashboard unit tests; Nest testing + supertest against a real Postgres (compose, dedicated test DB) for API integration; Playwright (later) for dashboard e2e.

- Tests prove behavior, not just return values. Prefer table-driven tests for parsers and policy rules.
- **Policy engine:** approved/unapproved destinations, HTTPS/SSH/scp-style normalization, lookalike and malformed hosts, prohibited filenames, synthetic secrets, conflicting policies, missing/expired/out-of-scope exceptions, audit-only vs enforce, fail-safe on errors.
- **Agent:** integration tests use temporary local repos plus bare repos as remotes and perform real `git push` through the installed hook. Must cover approved push, blocked push (bare remote unchanged), secret added then deleted in history, new branch, multiple refs, force-push, branch deletion, existing-hook preservation, install/uninstall reversibility, readable failure messages, offline/stale policy.
- **API:** unauthenticated, wrong role, cross-project access, revoked device, invalid approval scope, expired approval, malformed payloads, event-ingestion failure, redaction (no content fields accepted/stored).
- **Dashboard:** component tests for states (loading/empty/error), role-aware routing; server remains the real access control.
- Fixtures: synthetic only; never real repos, credentials or public repos with secrets. Construct secret-like strings at runtime.
- Tests must be deterministic: inject time, use temp dirs, clean up, no network beyond localhost.
- Do not skip, weaken or delete tests to get green. Report exactly which suites ran and passed.
