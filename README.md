# DevGuard

Developer security guardrail for company-managed laptops. A managed Git `pre-push` hook blocks pushes of protected repositories to unapproved destinations, scans outgoing commits for prohibited files and high-confidence secrets, and reports events to a central dashboard. Exceptions are scoped, expiring and approved server-side.

> **Status:** hackathon build. The agent (AG-1..8), the API (API-1..7) and a minimal admin dashboard (UI-1..7) are implemented and tested end to end. Alerts are minimal: email to security admins only ([ADR-016](docs/decisions/ADR-016-minimal-email-alerts.md)); the inbox, Slack/Teams (API-8 full, UI-8) and team-lead scoping ([ADR-014](docs/decisions/ADR-014-mvp-authorization-scope.md)) are not built. Status per module: [`docs/plans/module-roadmap.md`](docs/plans/module-roadmap.md).
>
> **Running it for a team?** See [`docs/usage.md`](docs/usage.md): install, enroll a laptop to a project, and monitor pushes.
>
> **Automated check:** `pnpm e2e:demo -- --port 3931` runs the whole flow end to end and prints PASS/FAIL.
>
> **Want to try it?** Follow [`docs/testing/how-to-test.md`](docs/testing/how-to-test.md): setup, a throwaway sandbox "laptop", and a walkthrough of every flow (block, secret, exception, offline, audit).

## Monorepo layout (pnpm workspaces)
```
apps/agent       endpoint CLI + Git hook (AG-*)         enroll, sync, hook, events, exceptions
apps/api         NestJS + Prisma + PostgreSQL (API-*)   auth, projects, policies, events, exceptions, audit, metrics
apps/dashboard   React + Vite + Tailwind (UI-*)         admin dashboard (ADR-015)
packages/shared  policy-engine  config                  contracts, pure policy logic, tooling
docs/  .claude/  CLAUDE.md
```

## Prerequisites
Node >= 22, pnpm >= 10 (`corepack enable`), Docker with Compose v2, Git >= 2.30.

## Setup
```bash
git clone <repo> && cd dev-guard
cp .env.example .env              # edit placeholders (never commit .env)
pnpm install
pnpm db:up                        # Postgres via Docker Compose on localhost:5433
docker compose ps                 # wait for "healthy"
set -a; . ./.env; set +a          # the Prisma CLI and seed read DATABASE_URL from the environment
pnpm --filter @devguard/shared build && pnpm --filter @devguard/policy-engine build
pnpm --filter @devguard/api prisma:deploy # apply migrations (API-1)
SEED_PASSWORD='a-12+-character-password' pnpm --filter @devguard/api seed   # synthetic demo users and data, idempotent (without SEED_PASSWORD a random one is printed once)
pnpm --filter @devguard/api build && pnpm --filter @devguard/api start   # http://localhost:3000, /health, OpenAPI at /docs (or start:dev from source)
# or run the API in a container: docker compose up -d api   (dev-only image; applies migrations at start)
pnpm --filter @devguard/dashboard dev     # http://localhost:5173 (proxies /v1 to DEVGUARD_API_URL, default http://localhost:3000)
```
**Or run everything in containers** (dev images, not hardened): after `cp .env.example .env`, run
```bash
docker compose up -d --build      # db, mailpit, api (applies migrations at start), dashboard
set -a; . ./.env; set +a
pnpm install && pnpm --filter @devguard/shared build
SEED_PASSWORD='a-12+-character-password' pnpm --filter @devguard/api seed   # the seed runs on the host against localhost:5433
# dashboard: http://localhost:5173 (nginx proxies /v1 to the api container), API: http://localhost:${API_PORT:-3000}, mail inbox: http://localhost:8025
```
Set `API_PORT` in `.env` if 3000 is taken on your machine. `DASHBOARD_BASE_URL` must stay `http://localhost:5173` (the published dashboard origin).
Stop infra: `pnpm db:down` (add `-v` to `docker compose down` to wipe local data).
Port note: Postgres is published on **5433** because 5432 is commonly in use; change `POSTGRES_PORT` and `DATABASE_URL` together if needed.

## How protection is configured
Admins and team leads configure everything in the dashboard: projects, classification, enforcement mode, canonical repos, approved destinations, and which employees are assigned. Developers only install the agent and enroll once with a token issued from the dashboard; repos are then matched to projects automatically (by root-commit fingerprint, falling back to remote match). See [ADR-008](docs/decisions/ADR-008-dashboard-managed-protection.md).

## Agent quick start
```bash
pnpm --filter @devguard/agent build              # `devguard` = node apps/agent/dist/main.js
echo '<token>' | devguard enroll --server <url> --token-stdin   # once per laptop; installs the global hook and syncs
devguard status [--check-server]                 # enrollment, hook state, cached policies, pending events
devguard sync                                    # refresh policies; also delivers queued events
devguard request-exception --destination <url> --reason "why"   # after a blocked push
devguard exception status                        # what became of your requests

# Local/offline mode (Gate 1, no backend) and fallback:
devguard install --repo ./my-repo                # per-repo hook
devguard register ./my-repo --project <id> --policy-file ./policy.json
devguard uninstall --repo ./my-repo
```

## Checks
```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Alerts
Built (minimal, [ADR-016](docs/decisions/ADR-016-minimal-email-alerts.md)): an email to active security admins when a push is blocked in enforce mode or an event has `secret_detected`/`scan_error`. Set `SMTP_HOST` to turn it on (empty = off). Delivery is best-effort: no retries, no throttling (a compromised device can send many mails), failures are logged and dropped. Local dev: `docker compose up -d mailpit` (inbox at http://localhost:8025).
Not built: in-app inbox, Slack/Teams, owner/lead recipients, exception-request mails, preferences (full design: ADR-009, [`alert-channels-setup.md`](docs/workflows/alert-channels-setup.md)).

## Architecture docs
[`component-responsibilities.md`](docs/architecture/component-responsibilities.md) (who owns what) and [`engineering-standards.md`](docs/architecture/engineering-standards.md) (code structure per app).

## Working with Claude Code
`CLAUDE.md` holds the persistent rules. Per module: `/plan-module <ID>` -> `/implement-module <ID>` -> `/verify-change` -> `/security-review`. Process: `.claude/workflows/module-delivery.md`.

## Limitations (honest summary)
- **Platform:** Linux only for the MVP/hackathon (built and tested there). macOS is untested; Windows is out of scope. Future work is listed in [ADR-010](docs/decisions/ADR-010-platform-scope.md).
- Local hooks can be bypassed or removed: `git push --no-verify`, deleting the hook, changing `core.hooksPath`, other clients/machines. The agent is not tamper-proof.
- Only Git push is covered. No browser upload, USB, email, network or OS-level enforcement.
- Only repos that resolve to an assigned project are protected; a repo the agent never matched is not.
- Repo-level `core.hooksPath` (e.g. husky) can override the global hook; this is detected and reported, not prevented.
- The secret detector is minimal and limited, not comprehensive.
- An event records an observed attempt and a policy decision, not proof of data exposure.
Full model: [`docs/architecture/security-model.md`](docs/architecture/security-model.md).
