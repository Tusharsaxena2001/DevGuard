# AG-2 Git hook installer (apps/agent)

**Responsibility:** safely install, report and remove the managed `pre-push` hook. (Product Git hook, not Claude Code hooks.)
**Depends on:** AG-1. See ADR-008.

## Modes
- **Global (default after enrollment):** `devguard install --global` writes the wrapper to `$DEVGUARD_HOME/hooks/pre-push` and sets `git config --global core.hooksPath` to that directory. If the user already has a global `core.hooksPath`, do not overwrite silently: record the previous value, chain to hooks in that directory, and restore it on uninstall.
- **Per-repo (fallback / Gate 1 / tests):** `devguard install --repo <path>`: resolve hooks dir via `git rev-parse --git-path hooks` (honors worktrees). An existing non-DevGuard `pre-push` is moved to `pre-push.devguard-orig` (mode preserved).

## Contract
- Wrapper contains a marker + agent version, runs `devguard hook pre-push "$@"` with stdin passed through, then chains to the original/repo-local `pre-push` (same args and stdin) only if DevGuard allowed. Chaining also covers `<repo>/.git/hooks/pre-push` when the global path is active.
- `devguard uninstall [--global|--repo]`: restore previous config/hook exactly; refuse to touch a hook without the marker.
- `devguard status`: installed or not, mode, chained original, and **overrides detected** (repo-level `core.hooksPath` that bypasses the global hook), per repo.
- If the agent binary is missing: matched/enforced repo => block with message; otherwise allow (documented).

## Implemented semantics (apps/agent; decisions in ADR-011)
- **Commands:** `install --global | --repo <path>` and `uninstall --global | --repo <path>` (no flag, or both, is a usage error: DevGuard does not guess). `status` shows global hook state, per-repo hooks and overrides; any problem (drift, override) makes it exit 2.
- **Global:** managed directory `$DEVGUARD_HOME/hooks` with the `pre-push` wrapper plus pass-through scripts for the other client and server-side hooks (a global `core.hooksPath` would otherwise disable every repo's own hooks; verified on Git 2.43). Order is crash-safe: scripts, then `install.json` (previous value), then `git config --global core.hooksPath`. A previous global value is kept, chained to (only after DevGuard allows) and restored exactly; `~` is expanded for chaining and the original text restored; empty or `~user` values are refused before writing. Uninstall leaves a `core.hooksPath` the user changed since install, and deletes only files with the marker on line 2. Unsetting the only key leaves an empty `.gitconfig`; the rest of the file is byte-identical.
- **Per repo:** hooks directory from `git rev-parse --git-common-dir` (works in worktrees). An existing foreign `pre-push` is moved to `pre-push.devguard-orig` (mode preserved) and chained to; if the backup name is taken, nothing is touched. Refused where the repo sets its own `core.hooksPath`. If writing the wrapper fails the user's hook is moved back; uninstall puts the wrapper back if restoring fails. Uninstall refuses a hook without the marker.
- **Wrapper:** see ADR-011 (pinned `DEVGUARD_HOME`/node/agent paths, `--`, missing agent blocks, chain only if allowed, same args and stdin via a temp file removed on exit and on HUP/INT/TERM). All paths are shell-quoted; newlines and NUL are rejected.
- **Overrides:** a repo-level `core.hooksPath` bypasses the hook; `status` reports it for the current repo, registered repos and per-repo installs. It cannot be prevented, nor can `--no-verify`.
- **Passthrough list** is fixed (`PASSTHROUGH_HOOKS`); a hook name not on it stops running under the global hook.
## Acceptance
Temp-repo tests: global install affects an existing and a new repo; repo-local pre-push still runs; prior global `core.hooksPath` preserved and restored; double install is a no-op; uninstall restores byte-identical state; repo-level hooksPath override is detected and reported; executable bit; `--no-verify` bypass documented. Tests set `HOME`/`GIT_CONFIG_GLOBAL` to a temp location, never touching the real user config.
**Verified:** unit tests with fakes (install/uninstall/status logic), shell-syntax checks of every generated script, adapter tests on real files, and end-to-end tests with real `git` in a sandbox `HOME`/global config: install affects existing and new repos, repo-local and user hooks still run (same arguments and stdin, only after DevGuard allows, failure propagates), other hooks keep working, previous `core.hooksPath` restored, global config byte-identical after install/uninstall (with and without a previous value), double install changes nothing, overrides and drift detected, per-repo install/uninstall restores the original byte for byte, worktrees, executable bits.
