# ADR-002: Policy engine is a pure, deterministic package

**Status:** accepted
**Decision:** `packages/policy-engine` takes explicit inputs (policy, normalized destination, outgoing-change summary, exceptions, `now`) and returns a `Decision`. No I/O, framework, clock or randomness access. Errors return a fail-safe decision.
**Why:** testable in isolation; identical logic on endpoint and server; prevents coupling to Nest/Prisma/React/CLI.
**Consequences:** callers (agent, API) gather inputs (git data, DB rows) and map results.
