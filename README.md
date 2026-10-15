# DevGuard

Developer security guardrail for company-managed laptops. A managed Git `pre-push` hook blocks pushes of protected repositories to unapproved destinations, scans outgoing commits for prohibited files and high-confidence secrets, and reports events to a central dashboard. Exceptions are scoped, expiring and approved server-side.

> **Status:** documentation and AI-native scaffolding are complete; application modules are implemented one at a time. See [`docs/plans/module-roadmap.md`](docs/plans/module-roadmap.md) for what exists. Commands below marked *(planned)* work only after the listed module lands.

## Monorepo layout (pnpm workspaces)
```
apps/agent       endpoint CLI + Git hook (AG-*)         [AG-1..3: CLI, local store, hook installer, pre-push runner]
apps/api         NestJS + Prisma + PostgreSQL (API-*)   [planned]
apps/dashboard   React + Vite + Tailwind + shadcn (UI-*)[planned]
packages/shared  policy-engine  config                  [planned]
docs/  .claude/  CLAUDE.md
```

## Prerequisites
Node >= 22, pnpm >= 10 (`corepack enable`), Docker with Compose v2, Git >= 2.30.

## Setup
```bash
git clone <repo> && cd dev-guard
cp .env.example .env              # edit placeholders (never commit .env)
pnpm install                      # (planned: once workspaces exist)
pnpm db:up                        # Postgres via Docker Compose on localhost:5433
docker compose ps                 # wait for "healthy"
pnpm --filter api prisma migrate deploy   # (planned: API-1)
pnpm --filter api seed                    # (planned: API-1) synthetic demo data
pnpm --filter api start:dev               # (planned: API-1) http://localhost:3000, docs at /docs
pnpm --filter dashboard dev               # (planned: UI-1) http://localhost:5173
```
Stop infra: `pnpm db:down` (add `-v` to `docker compose down` to wipe local data).
Port note: Postgres is published on **5433** because 5432 is commonly in use; change `POSTGRES_PORT` and `DATABASE_URL` together if needed.

## How protection is configured
Admins and team leads configure everything in the dashboard: projects, classification, enforcement mode, canonical repos, approved destinations, and which employees are assigned. Developers only install the agent and enroll once with a token issued from the dashboard; repos are then matched to projects automatically (by root-commit fingerprint, falling back to remote match). See [ADR-008](docs/decisions/ADR-008-dashboard-managed-protection.md).

## Agent quick start *(local mode available: AG-1..AG-4; enrollment is AG-5)*
```bash
pnpm --filter agent build
devguard enroll --server <url> --token <token>   # once per laptop (AG-5); installs the global hook
devguard status                                  # hook state, matched repos, overrides detected

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
Blocked pushes and exception requests notify the responsible owner/leads (and security admins for high-severity items) via an in-app inbox, email, and per-project Slack/Teams webhooks. Local dev: `docker compose up -d mailpit` (inbox at http://localhost:8025). Setup for Slack/Teams: [`docs/workflows/alert-channels-setup.md`](docs/workflows/alert-channels-setup.md). Decision: ADR-009.

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
