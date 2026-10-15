# ADR-011: How the managed Git hook decides, and where it must fail closed

**Status:** accepted
**Context:** AG-2 (installer) and AG-3 (runner). The hook runs inside every `git push` on the laptop. It must never allow a push because it was blind, confused or invoked oddly, but it must not break developers' other tooling.

## Decisions
1. **The wrapper pins its environment.** `install` writes `DEVGUARD_HOME` and the absolute paths of node and the agent into the wrapper, and the wrapper exports `DEVGUARD_HOME` itself. A different environment or `PATH` at push time cannot swap in other state or another binary. The wrapper calls `hook pre-push -- "$@"` (the `--` matters: a remote named `-h` must be an operand, not help) and any non-zero agent exit blocks. Editing or deleting the wrapper, `--no-verify`, `git -c core.hooksPath=...` and a repo-level `core.hooksPath` remain possible and are documented, not prevented.
2. **Missing agent => block.** If node or the agent file is gone the wrapper cannot know whether the repo is protected, so it blocks with instructions to remove the hook. (The AG-2 spec's "otherwise allow" cannot be implemented without the agent; failing open is the thing the product promises not to do.)
3. **What the hook needs.** Only `repos.json` and the policy cache; not enrollment or credentials (local/Gate-1 mode has neither).
   - Repo matches no project => allowed silently, no event (ADR-003).
   - State unreadable or untrusted, or a registered repo without a usable policy => **blocked** ("cannot tell whether protected").
   - Errors after the project is known follow its mode; **only exactly `audit_only` may allow on error**, anything else (including an unknown value) blocks.
   - Recording the event is best effort and never changes the decision (ADR-004).
4. **The hook handles `hook` help/version as failure.** `devguard hook ...` never exits 0 for help, because exit 0 means "allowed".
5. **A global `core.hooksPath` hides every repo's own hooks**, so the managed directory also contains pass-through scripts for the other client and server-side hooks (a fixed list, in `hook-wrapper.ts`). A previous global `core.hooksPath` is recorded, chained to (it replaced the repo's own hooks before DevGuard, so the repo's own hook is not run in addition), and restored on uninstall. Values DevGuard cannot chain to safely (empty, `~user`) are refused before anything is written.
6. **Managed files are recognised by a marker on line 2.** Install, uninstall and chaining treat only such files as DevGuard's; a user's hook that merely mentions the marker is never overwritten, deleted or skipped.
7. **What is scanned.** Each outgoing commit separately (`rev-list`, range per ref); paths via `diff-tree -z`, added lines via a text diff (`-a`, so NUL bytes or a pusher-controlled `-diff` attribute cannot hide content); deleted files are not passed to the file-name rule (the commit that adds the file is flagged; removing a `.env` is the fix); refs that do not peel to a commit (a tag on a blob or tree) cannot be scanned and are an error finding. Caps (2000 commits, output size) and per-commit Git failures become `scan_error` findings, which block in enforce mode. Diffs run via `execFile` with `--no-ext-diff --no-textconv`.
8. **Interim repo resolution (superseded by ADR-012; AG-4 is done).** Manual only: the repo's root, or the root of its main work tree (so linked worktrees are protected), must equal a path in `repos.json`. AG-4 adds fingerprint and remote matching and canonicalises paths at registration (a symlinked registration does not match today).
9. **Policy staleness is deferred.** ADR-004's `DEVGUARD_POLICY_MAX_STALE_MINUTES` needs a server to be "unreachable"; there is none yet, so a cached policy's age is not evaluated (a test pins this). AG-6 implements it.
10. **Exceptions are not consulted by the hook** (they need the server: ADR-004/007); `exceptions: []` is passed to the decision engine.

## Consequences / honest limits
- Unusable state or a moved agent blocks pushes in *every* repo, including unprotected ones, until fixed (`devguard status`, `devguard uninstall`). Deleting `repos.json` silently unprotects the repos it listed: local state is user-owned and unauthenticated (events too), so AG-7 must not treat `events.jsonl` as evidence.
- Without remote-tracking refs (never fetched, or a URL as remote name) a new branch scans the whole reachable history, which may hit the commit cap and block. Scanning more is the safe direction.
- `install.json` is read-modify-written without a lock; concurrent installs can lose a record (affects uninstall/status only).
- Binary files that Git treats as text under `-a` are scanned as text; genuinely binary secrets (compressed, encrypted) are not detected (ADR-005).
- Linux only (ADR-010).
