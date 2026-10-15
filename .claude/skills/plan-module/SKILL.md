---
name: plan-module
description: Plan a DevGuard module (e.g. SH-2, AG-3, API-6, UI-5) before any code changes. Use when asked to plan, scope or prepare a module or vertical slice.
argument-hint: <module-id>
---

# Plan a module

Input: a module ID from `docs/plans/module-roadmap.md` (`$ARGUMENTS`). If missing or unknown, list the roadmap and ask.

1. Read `docs/plans/module-roadmap.md`, the module spec `docs/modules/<surface>/<ID>-*.md`, `.claude/rules/architecture.md`, `.claude/rules/security.md`, and the specs of its dependencies. Confirm dependencies are `done`; if not, say so and stop.
2. Read only the existing code the spec touches. Do not scan the whole repo.
3. Produce the plan using `template.md` (adjacent file): scope, out-of-scope, affected interfaces and contracts, data contracts/migrations, security implications, acceptance criteria, test cases, file list, risks, open questions.
4. Do **not** edit code. Write nothing except the plan (print it; save under `docs/plans/modules/<ID>.md` only if the user asks).
5. End by naming the next step: `/implement-module <ID>`.
