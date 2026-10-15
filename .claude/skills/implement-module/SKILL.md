---
name: implement-module
description: Implement exactly one bounded DevGuard module or vertical slice (e.g. SH-2, AG-3, API-6) with tests and doc updates. Use after the module has been planned.
argument-hint: <module-id>
---

# Implement a module

Input: module ID (`$ARGUMENTS`). One module per run; never bundle modules.

1. Read the module spec, `docs/plans/module-roadmap.md`, `.claude/rules/*.md`, and `.claude/workflows/module-delivery.md`. Verify all dependencies are `done`; otherwise stop and report.
2. If no plan exists in this conversation, run the `/plan-module` steps first (briefly).
3. Set the roadmap status to `in-progress`.
4. Implement the smallest coherent change that meets the acceptance criteria. Respect dependency direction; keep policy logic in `packages/policy-engine`; validate boundaries with Zod from `packages/shared`.
5. Write tests alongside the code per `.claude/rules/testing.md` (including failure/bypass cases from the spec). Never use real secrets; build synthetic values at runtime.
6. Walk through `structure-checklist.md` (adjacent file) and fix layering or separation-of-concerns violations. Then run `/verify-change`. Fix root causes; do not weaken checks.
7. For security-sensitive modules (policy-engine, hook, auth, devices, events, exceptions) run `/security-review` and address findings; optionally launch the `security-reviewer` and `test-reviewer` agents for an independent read-only pass.
8. Update the module spec (contract changes), add ADRs for material decisions, and set the roadmap status to `done` only if verification passed.
9. Report: files changed, evidence of what ran and passed, known gaps, next module.

Do not touch unrelated modules, push to remotes, or run destructive git commands.
