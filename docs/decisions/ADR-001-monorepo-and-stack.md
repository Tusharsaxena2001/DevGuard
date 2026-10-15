# ADR-001: pnpm monorepo, modular monolith, default stack

**Status:** accepted
**Decision:** pnpm workspaces monorepo (apps/agent, apps/api, apps/dashboard, packages/shared, packages/policy-engine, packages/config). TypeScript strict; NestJS + Prisma + PostgreSQL; React + Vite + Tailwind + shadcn/ui; Zod for shared contracts; Vitest; Docker Compose for infra only. Modular monolith, no microservices.
**Why:** one language and shared contracts across agent/API/UI; the policy engine is reused by agent and API; small team and 15-day window.
**Consequences:** shared packages must stay dependency-light; agent must remain independently runnable. Host Postgres port is 5433 because 5432 is commonly occupied.
