# Architecture

Modular monolith in a pnpm-workspaces monorepo.

```
 Developer laptop                         Central
┌───────────────────────┐          ┌──────────────────────────────┐
│ git push              │          │ apps/api (NestJS)            │
│   └─ pre-push hook ───┼─ run ──► │  auth/RBAC · devices         │
│ apps/agent (devguard) │          │  projects · destinations     │
│  ├ git adapter        │ HTTPS    │  policies · events           │
│  ├ policy-engine (lib)│◄────────►│  exceptions · audit · metrics│
│  ├ local cache/creds  │  sync,   │  Prisma ─► PostgreSQL        │
│  └ event spool        │  events  └───────────────▲──────────────┘
└───────────────────────┘                          │ REST (cookie JWT)
                                          apps/dashboard (React/Vite)
```

## Workspaces and responsibilities
| Workspace | Responsibility | Depends on |
|-----------|----------------|-----------|
| packages/shared | Zod schemas/types: roles, policy, destination, decision, event, exception, API DTOs | — |
| packages/policy-engine | Pure deterministic evaluation (URL normalization, allowlist, file/secret rules, modes, exception validity) | shared |
| packages/config | tsconfig/eslint/vitest presets | — |
| apps/agent | CLI, hook install/uninstall, pre-push runner, enrollment, sync, event delivery | shared, policy-engine |
| apps/api | Authoritative policy, identity, events, approvals, audit, metrics | shared, policy-engine |
| apps/dashboard | Admin UI | shared (types) |

## Key flows
1. **Enroll:** admin issues one-time token -> `devguard enroll` -> API returns per-device secret (stored 0600 locally, hash server-side).
2. **Assign and match (ADR-008):** admins/leads create projects and assign employees in the dashboard; the agent syncs the employee's projects and auto-matches local repos (root-commit fingerprint, remote match; manual `register` is a fallback). A global hooks path means no per-repo install.
3. **Push:** git runs hook with `<remote> <url>` + stdin ref lines -> agent normalizes destination, evaluates with cached policy, scans commits in outgoing range, decides allow/block, emits event, prints explanation, exits non-zero to block.
4. **Exception:** blocked -> `devguard request-exception` -> lead approves in dashboard (project + destination + expiry) -> retry push; agent asks API to validate; API is authoritative.
5. **Offline:** per ADR-004.

6. **Alert:** on a block or exception request the API resolves recipients from memberships, writes inbox and delivery rows transactionally, and a worker sends email/Slack/Teams (ADR-009). Failures never affect pushes.

Ownership per component: `component-responsibilities.md`. Internal code structure per app: `engineering-standards.md`.
Details: `docs/workflows/`. Data model: `docs/modules/api/API-1-foundation.md`. Threats: `security-model.md`.

## Data model (entities)
User, Membership (role + project/team scope), Device, Project, RepoRegistration, ApprovedDestination, Policy, PolicyVersion, ExceptionRequest, ExceptionDecision, SecurityEvent, AdminAuditEvent. Stable UUIDs, timestamps, FKs, unique constraints (e.g. project+normalized destination), enum lifecycle states, indexes on event query fields.

## Local environment
`docker compose up -d db` (Postgres, host port 5433). API/dashboard run via pnpm for now; compose services added in X-1. Agent runs natively on the host.
