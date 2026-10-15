# Engineering standards

Goal: code that is modular, has clear separation of concerns, and is easy to read. Applies to every module (`.claude/rules/architecture.md` summarises; this is the detail). Responsibilities of each component: `component-responsibilities.md`.

## Principles
1. **One responsibility per file and per function.** If you need "and" to describe it, split it.
2. **Thin entry points.** Controllers, CLI commands and React pages parse input, call one use case, and shape output. No business logic.
3. **I/O at the edges, pure logic in the middle.** Decisions live in pure functions (`policy-engine`, use cases); Git, DB, HTTP, FS, clock sit behind adapters or repositories.
4. **Dependency injection.** Collaborators are passed in (Nest DI, constructor/params in the agent). Nothing constructs its own DB client, HTTP client or clock deep inside logic.
5. **Explicit names over comments.** Comments explain *why*, not *what*.
6. **Size is a smell, not a rule.** Files over ~250 lines or functions over ~40 lines should be justified or split.
7. **No cross-feature reach-ins.** Features talk through public service interfaces (API) or via `shared` (dashboard).
8. **No speculative abstraction.** Extract on the second real use, not the first imagined one.
9. **Fail safe, fail loud.** Typed errors with stable codes (`ErrorCode` in shared); security-critical parsers return `{ok:false}` and callers deny.

## apps/api (NestJS): feature modules, same layers each
```
src/modules/<feature>/
  <feature>.controller.ts   HTTP only: route, guards, parse DTO (Zod from shared), call service, return DTO
  <feature>.service.ts      use cases, business rules, authorization on resources (scope checks)
  <feature>.repository.ts   the ONLY Prisma user for this feature; returns domain objects, not Prisma models
  <feature>.mapper.ts       entity -> shared DTO
  <feature>.module.ts       wiring; exports the service only
  *.spec.ts / *.e2e-spec.ts colocated tests
src/common/    guards (auth, device, roles, project scope), filters, logging + redaction, pipes
src/prisma/    client, migrations      src/config/   validated env (Zod)
```
Rules: controllers hold no business logic; services never import Prisma or another module's repository (call that module's service); audit rows are written by `AuditService` in the same transaction as the change; policy decisions come from `policy-engine`; modules export only their service.

## apps/agent: ports and adapters with a composition root
```
src/main.ts           composition root: build adapters, wire use cases, register commands
src/cli/              commander commands: parse args -> call a use case -> print. No logic.
src/use-cases/        enroll, install-hooks, run-pre-push, sync, resolve-repo, request-exception (orchestration over ports)
src/ports/            interfaces: GitPort, ConfigStore, ApiClient, Clock, Logger
src/adapters/         git (execFile, no shell), fs-store (0600, atomic writes), http-api-client, hook-installer
src/presentation/     user-facing block/allow messages (never secrets)
```
Rules: the pre-push runner never imports commander; Git is reached only through `GitPort`; use cases are unit-tested with fakes; adapters are tested against real temp repos/dirs.

## apps/dashboard (React): feature folders
```
src/app/                   router, providers, auth/role guard, layout
src/features/<feature>/    api/ (TanStack Query hooks over the typed client), components/, pages/
src/shared/ui/             shadcn components; DataTable, StatusBadge, EmptyState, ErrorState, LoadingState
src/shared/lib/            api client, formatting
```
Rules: pages compose, components are presentational; server state only via query hooks in `features/*/api`; no business or security rules in components (role-aware UI is convenience, the API enforces); features do not import each other (promote shared pieces to `shared/`).

## Naming and conventions
- Files `kebab-case.ts`; classes `PascalCase`; functions/variables `camelCase`; constants `UPPER_SNAKE` only for true constants; Zod schemas `FooSchema`, inferred types `Foo`.
- Colocate tests (`foo.test.ts` next to `foo.ts`); integration/e2e in `test/` of the app.
- Use-case names are verbs (`runPrePush`, `approveException`); repositories are nouns of storage (`ExceptionRepository`).
- Errors: typed classes carrying an `ErrorCode`; map to HTTP/CLI exit codes at the edge only.

## Testing per layer
| Layer | Test style |
|---|---|
| Pure logic (`policy-engine`, mappers) | Table-driven unit tests |
| Use cases / services | Unit tests with fakes/mocks of ports and repositories |
| Repositories | Integration against the test Postgres |
| Controllers/guards | Supertest e2e: auth, roles, scope, validation |
| Agent adapters | Real temp Git repos and bare remotes |
| Dashboard components | State tests (loading/empty/error) and role routing |

## Good vs bad (illustrative)
- **API.** Bad: controller calls `prisma.exception.update` and checks the role inline. Good: controller calls `exceptionService.approve(actor, id, dto)`; the service checks scope and self-approval, calls `exceptionRepository.save`, and `auditService.record` in one transaction.
- **Agent.** Bad: `cli/push.ts` runs `git rev-list` and parses output itself. Good: `cli/hook.ts` calls `runPrePush(input)`, which uses `GitPort.revList()` and `evaluatePush()`.
- **Dashboard.** Bad: a component fetches with `fetch()` and decides visibility by role string. Good: `useExceptions()` in `features/approvals/api`; the page renders `<ApprovalsTable>`; the route guard handles role-based navigation.

## Enforcement (lands with each app skeleton)
ESLint `no-restricted-imports`: controllers cannot import `@prisma/client`; services cannot import repositories of other modules; `cli/` cannot import `adapters/` directly; `features/*` cannot import other features. Plus a small boundary test that fails on violations.
