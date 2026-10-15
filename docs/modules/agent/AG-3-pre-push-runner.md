# AG-3 pre-push runner (apps/agent)

**Responsibility:** implement the real Git pre-push contract and enforce policy locally.
**Depends on:** AG-1, SH-4.

## Contract
- Input: argv `<remote-name> <remote-url>`; stdin lines `<local-ref> <local-sha> <remote-ref> <remote-sha>`.
- Git adapter (single module): `isAncestor`, `revList(range)`, `changedPaths(commit)`, `addedLines(commit)`; all via `execFile` with arguments array (no shell), output size limits.
- Ranges: new branch (remote sha zeros) => commits reachable from local sha not reachable from `refs/remotes/<remote>/*`; update => `remote..local`; delete (local sha zeros) => no scan, still evaluate destination; force-push detection when remote sha not ancestor of local sha (remote sha missing locally => treated as non-fast-forward, flagged); tags handled as refs.
- Content: for every commit in range, changed paths -> prohibited-file rules; added lines -> secret detector. Deleted-later files are still detected because each commit is inspected.
- Calls `evaluatePush`, prints a human explanation (rule, destination, project, next step), emits event via AG-7 (stub: local log until API exists), exits 0/1.
## Acceptance (integration, real `git push` to local bare repos)
Approved push succeeds; unapproved blocked and bare repo refs unchanged; secret committed then deleted detected; new branch; multi-ref push where one ref violates blocks all; force-push flagged; branch delete allowed/blocked per destination; audit-only allows and records; git failure => documented behavior.
## Implemented semantics (apps/agent; decisions in ADR-011)
- **Entry:** `devguard hook pre-push <remote-name> <remote-url>` (hidden); stdin parsed strictly (40/64-hex ids of one length, <= 1000 refs, anything else blocks). Never exits 0 for help/usage errors; exit 1 = blocked, 0 = allowed, any other code is also non-zero and blocks.
- **Ranges:** new branch or unknown remote object => `local --not --remotes=<remote-name>` (scans more when tracking refs are missing); update with a known remote commit => `remote..local`; deletion => no scan, destination still judged; force-push = remote object missing locally or not an ancestor (flagged in the message and as `operation: force_push`); a commit reachable from several refs is inspected once. Refs that do not peel to a commit are a `scan_error`.
- **Content:** per commit, changed non-deleted paths (`diff-tree -z`) through `findProhibitedFiles`, added lines (text diff, `-a`) through `scanAddedLines` with line numbers; a secret added then deleted inside the range is found in the adding commit. Failures, the 2000-commit cap and non-commit refs are `scan_error` findings.
- **Decision:** `evaluatePush` (SH-4) with `exceptions: []`. Exit mapping: blocked => 1; `error` => 1 unless the mode is exactly `audit_only`; allowed/exception => 0.
- **Fail closed (resolves the AG-1 review requirement):** unreadable/untrusted state, a registered repo whose policy is missing or unusable, not-a-repository, or unintelligible stdin => blocked with "could not check". A repo that resolves to no project is allowed silently with no event (ADR-003). The mode is unknown when the policy is unusable, so audit-only cannot soften that. Everything after the project is known follows the mode.
- **Output:** project, destination (normalized; the raw URL is never echoed), reasons, per-finding rule/path/line/commit, next step, and a reference id; file names are sanitised against terminal escapes and bidi tricks. Clean allows are silent. No file contents or secret values appear in output or events.
- **Events:** one `SecurityEventInput` per protected push appended to `$DEVGUARD_HOME/events.jsonl` (0600, strict schema); a failure to record never changes the decision and is reported to the developer. Delivery to the server is AG-7; the file is unauthenticated local data.
- **Repo resolution:** interim manual-only (see ADR-011 #8). Worktrees resolve through the main checkout.
- **Not in AG-3:** policy staleness (AG-6, ADR-004), exceptions (AG-8), fingerprint/remote matching (AG-4).
## Failure behavior
Internal error => `error` outcome, block in enforce; message includes correlation id, no secrets.
**Verified:** unit tests (runner matrix of state x mode x violation, scan baselines, parser, resolver, presentation), the Git adapter against real temporary repositories (unusual names, merges, root commits, annotated tags, blobs, worktrees, option injection, `diff.external`/textconv never run), and end-to-end tests that run real `git push` through the installed hook to local bare repos (realistic `git@github.com:` URLs routed by a fake ssh command): approved push, unapproved blocked with the bare repo unchanged, rewired remote, secret added then deleted, other secret types, binary-looking files, prohibited files, renames, tags (lightweight, annotated, deleted, on a blob), merge-conflict resolutions, new branches, multi-ref, force-push (clean, with a secret, to an unapproved remote), deletes, `pushurl`/`pushInsteadOf`/URL-as-remote-name, subdirectory and worktree pushes, audit-only, missing policy, untrusted state, missing agent, broken event log, `DEVGUARD_HOME` spoofing, `--no-verify`.
