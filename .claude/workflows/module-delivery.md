# Module delivery workflow

How every module (SH-*, AG-*, API-*, UI-*, X-*) goes from spec to done. Status lives in `docs/plans/module-roadmap.md`.

```
/plan-module <ID>  ->  /implement-module <ID>  ->  /verify-change  ->  /security-review (if sensitive)  ->  update docs + roadmap
```

## Rules
1. One module at a time; dependencies must be `done`.
2. Plan before code; plans are short and use `.claude/skills/plan-module/template.md`.
3. Smallest coherent change, tests with the code, no unrelated edits.
4. Verification is mandatory and honest: report what ran and passed, and what did not run.
5. Sensitive modules (SH-2/3/4, AG-2/3, API-2/5/6) get `/security-review` and the read-only `security-reviewer` and `test-reviewer` agents. Agents never edit; the primary agent integrates fixes.
6. Contract changes update the module spec and all consumers in the same change. Material decisions get an ADR.
7. A module is `done` only when acceptance criteria in its spec are met and verified.

## Phase gates
- **Gate 1 (after AG-4):** with no backend, a protected repo's push to an unapproved destination is blocked, to an approved destination succeeds, history secrets are detected, hook is reversible. Demonstrate with temp repos before starting API modules.
- **Gate 2 (after AG-7):** events from the agent appear via the API with device identity; no content fields stored.
- **Gate 3 (after AG-8 + UI-6):** blocked push -> exception request -> approval in dashboard -> retry succeeds -> expiry blocks again.
- **Gate 4 (X-2):** clean-clone setup works from README; limitations documented.

## Claude Code lifecycle hooks vs the product Git hook
`.claude/hooks/` automates *development* (see its README). The `pre-push` hook is the *product* (apps/agent). Never combine them.
