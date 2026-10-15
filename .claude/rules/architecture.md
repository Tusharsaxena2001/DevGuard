# Architecture rules

Applies to all code. Overview: `docs/architecture/architecture.md`. Detailed structure and conventions: `docs/architecture/engineering-standards.md`. Who owns what: `docs/architecture/component-responsibilities.md`.

## Dependency direction
`apps/agent`, `apps/api` -> `packages/policy-engine` -> `packages/shared`. `apps/dashboard` -> `packages/shared` only (types/schemas). Apps never import each other. `packages/*` never import from `apps/*`.

## Layers (summary; see engineering-standards.md)
- **api:** controller (HTTP only) -> service (use cases, business rules, resource authorization) -> repository (only Prisma user). Services call other services, never other repositories. Prisma models never leak past repositories; map to shared DTOs. Audit written in the same transaction.
- **agent:** `cli/` (parse, call, print) -> `use-cases/` -> `ports/` implemented by `adapters/`; `main.ts` is the composition root. The pre-push runner never imports commander; Git only through `GitPort`.
- **dashboard:** pages compose; components presentational; server state via TanStack Query hooks in `features/*/api`; features never import each other; no business/security rules in components.

## Policy engine
Pure functions, injected inputs (policy, destination, outgoing change summary, exceptions, `now`). Returns a `Decision` from shared contracts. No I/O, no globals, no clock calls. Errors become a safe `deny`/`error` decision, not exceptions escaping to callers.

## Contracts
Request/response/event/decision shapes are Zod schemas in `packages/shared`; infer types from them. Changing a contract requires updating every consumer and the module spec in the same change. Version breaking changes to the agent-facing API.

## Process
Keep modules bounded. One responsibility per file; thin entry points; dependency injection. No speculative abstractions, no empty directories, no new dependency without clear value. Record consequential choices as ADRs in `docs/decisions/`.
