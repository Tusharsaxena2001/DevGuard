---
name: verify-change
description: Run tests, lint, type-check and build for the workspaces affected by the current change, fix failures caused by it, and report exactly what was and was not verified.
argument-hint: [workspace-filter]
allowed-tools: Bash, Read, Edit, Grep, Glob
---

# Verify a change

1. Determine touched workspaces (from the user's argument `$ARGUMENTS`, or by inspecting changed files). Map paths to workspaces: `apps/agent`, `apps/api`, `apps/dashboard`, `packages/*`. A change in `packages/shared` or `packages/policy-engine` also requires its dependants.
2. Run, per affected workspace (`pnpm --filter <name> <script>`), in this order: `typecheck`, `lint`, `test`, `build`. API integration tests need `pnpm db:up` first; check Postgres health before running.
3. On failure: read the output, find the root cause, fix code (or the test if the test is wrong, with justification). Never suppress errors, add `@ts-ignore`, skip tests, or loosen assertions to pass. Re-run until green or blocked.
4. Run the secret-hygiene check in `checks.md` (adjacent file).
5. Report a table: command, result (passed/failed/not run), and why anything was not run. State plainly what remains unverified. Do not claim success for anything that did not run.
