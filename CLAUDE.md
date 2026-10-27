# DevGuard

Developer security guardrail for company-managed laptops. A managed Git `pre-push` hook (endpoint agent) blocks pushes of protected repos to unapproved destinations, scans outgoing commits for prohibited files and secrets, and reports events to a central API/dashboard. Exceptions are scoped, expiring and approved server-side.

**Status:** agent, API, dashboard and shared packages are implemented; the alerts module (API-8) is a minimal slice and UI-8 is deferred. Current per-module status is in `docs/plans/module-roadmap.md`. Implement module by module and do not go beyond the module you were asked to.

## MVP scope (three capabilities)
- **A. Git protection:** enroll device once; global managed `pre-push` hook; repos auto-matched to dashboard-defined projects; block unapproved destinations, scan outgoing history, audit-only mode.
- **B. Dashboard:** auth + RBAC, devices, projects, destinations, policies, events, approvals, audit history, metrics.
- **C. Exceptions:** request → approve/reject (scoped to project + destination, with reason and expiry) → retry push.

**Non-goals:** browser/USB/kernel enforcement, DLP, keystroke/screenshot monitoring, AI-based push decisions, tamper-proof claims, microservices. Never claim complete exfiltration prevention.

## Repository structure
```
apps/agent       Node/TS CLI `devguard` (hook install, pre-push runner, enrollment, sync)
apps/api         NestJS + Prisma + PostgreSQL (authoritative policy, events, approvals)
apps/dashboard   React + Vite + Tailwind (hand-written components, ADR-015)
packages/shared         Zod contracts, enums, roles, event/decision types
packages/policy-engine  Pure deterministic policy logic (no I/O frameworks)
packages/config         Shared tsconfig base (ESLint config lives in the root eslint.config.js)
docs/            product, architecture, modules/{shared,agent,api,ui}, workflows, security, plans, decisions
.claude/         rules, skills, agents, hooks, workflows, settings.json
```
pnpm-workspaces monorepo. Dev infrastructure via Docker Compose (Postgres on host port **5433**).

## Commands
Run from repo root. Commands marked * need the owning module's prerequisites (database up, `.env` loaded).
```
pnpm install                 # install all workspaces
cp .env.example .env         # then edit placeholders locally
pnpm db:up                   # Postgres via docker compose
pnpm build | typecheck | lint | test      # all workspaces (recursive)
pnpm --filter <pkg> <script>              # one workspace, e.g. @devguard/policy-engine
pnpm --filter api prisma migrate dev *    # API-1
pnpm --filter api seed *                  # API-1
pnpm --filter agent devguard <cmd> *      # AG-1
```
Full setup: `README.md`.

## Components (details: `docs/architecture/component-responsibilities.md`)
- **Agent:** enforcer on the laptop (hook, matching, local decision, event spool). Never authoritative.
- **API:** source of truth (auth/RBAC, policy, devices, events, exceptions, audit, alerts).
- **Dashboard:** control surface for people. No security decisions; the API enforces access.
- Structure and conventions per app (controller/service/repository; ports and adapters; feature folders): `docs/architecture/engineering-standards.md`. Follow them in every module.

## Architecture rules (details: `.claude/rules/architecture.md`)
- Dependency direction: `apps/* -> packages/policy-engine -> packages/shared`. Never reverse. Apps never import other apps.
- `policy-engine` is pure and deterministic: no Nest, Prisma, React, fs, network, CLI parsing, clock/randomness except via injected parameters.
- Contracts live in `packages/shared`; API, agent and dashboard all use them. The API's policy is the single source of truth.
- Agent must run without the dashboard and (for local enforcement) without the API using cached policy.

## Security invariants (details: `.claude/rules/security.md`, `docs/architecture/security-model.md`)
1. Authz is enforced on the backend for every protected operation; UI hiding is not access control.
2. Fail safe: unparsable/ambiguous destination or policy error => treated as unapproved (enforce) — never silently allow.
3. Destination match = exact normalized host + repo path. Never substring/suffix/regex-prefix matching.
4. The hook scans **outgoing commits** (per Git pre-push stdin contract), not the working tree.
5. Never send file contents or secret values off the device or into logs/events: only rule id, secret type, file path.
6. Server validates exception scope (project + destination), expiry and approver role. Never trust client claims of approval. Approver != requester.
7. Offline/stale policy for protected repos is explicit: enforce => block, audit-only => allow + local record. Documented in ADR.
8. Protection is configured in the dashboard (ADR-008); developers do only a one-time enroll. A repo is protected only if it resolves to an assigned project (root-commit fingerprint, remote match, or manual fallback); unmatched repos are NOT protected (ADR-003, documented, not assumed).
9. Changes to policy/approvals/devices produce an attributable admin audit event; history is append-only.
10. Never log or commit secrets, tokens, passwords, Authorization headers. Test fixtures use synthetic values built at runtime.
11. Claude Code lifecycle hooks (`.claude/hooks`) and the product's Git `pre-push` hook are unrelated mechanisms — never mix them.

## Where to find things
- Product/PRD: `docs/product/PRD.md`; architecture: `docs/architecture/`
- Module specs: `docs/modules/<surface>/<ID>-*.md` (IDs: SH-*, AG-*, API-*, UI-*, X-*)
- Roadmap + status: `docs/plans/module-roadmap.md`; day plan: `docs/plans/15-day-mvp-plan.md`
- Flows and failure cases: `docs/workflows/`; decisions: `docs/decisions/ADR-*.md`
- Skills: `/plan-module`, `/implement-module`, `/verify-change`, `/security-review`; agents: `security-reviewer`, `test-reviewer`
- Process: `.claude/workflows/module-delivery.md`

## Definition of done for any change
Run `/verify-change` (tests, typecheck, lint, build for touched workspaces); `/security-review` for security-sensitive changes; update the module spec and roadmap status; record material decisions as ADRs. Report only what actually ran and passed. Never weaken a check to get green. Never push to remotes, run destructive git commands, or commit secrets.
