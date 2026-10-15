# Workflow: protected push

1. A global `core.hooksPath` (set once at enrollment, ADR-008) makes Git run the DevGuard wrapper as `pre-push <remote-name> <remote-url>`; stdin has one line per ref: `<local ref> <local sha> <remote ref> <remote sha>`.
2. Agent resolves the repo to a project (AG-4: root-commit fingerprint, then remote, then manual). No match => allow, no event (ADR-003).
3. Load policy (fresh or cached per ADR-004). Normalize remote URL; evaluate allowlist.
4. For each ref line: skip content scan for deletions (local sha all zeros); for new branches (remote sha zeros) scan commits reachable from local sha not on any remote-tracking ref of this remote; otherwise scan `remote..local`. Detect force-push (remote sha not an ancestor of local sha) and report it.
5. Scan every commit in range for prohibited paths (even if later deleted) and secret patterns in added lines.
6. Decide per mode: enforce => block on violation (exit 1) with explanation; audit-only => allow, record would-have-blocked.
7. Emit event (spooled if offline). Print rule id, destination, project, next step (request exception). On allow, chain to the repo's own pre-push hook if any.

## Failure cases
| Case | Behavior |
|------|----------|
| Unparseable remote URL | Treated as unapproved |
| Git command fails inside hook | Block in enforce with "DevGuard error" and error event; audit-only allows |
| API down | ADR-004 |
| Repo's remote rewired to a personal repo | Still resolves via fingerprint; blocked |
| Repo never matched (e.g. local `git init` pushed straight to personal remote) | Unprotected; documented limitation |
| Repo-level `core.hooksPath` (e.g. husky) overrides global | Not preventable; reported via status/heartbeat |
| `--no-verify` / hook removed | Not detectable by the hook; documented |
