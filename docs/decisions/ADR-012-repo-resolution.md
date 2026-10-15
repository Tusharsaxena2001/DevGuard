# ADR-012: How the agent decides which project a repo belongs to

**Status:** accepted
**Context:** AG-4. ADR-003/008 say a repo is protected only if it resolves to a project. This records how, and where the hook must fail closed.

## Decisions
1. **Three signals, evaluated every push, no network.** (a) *fingerprint*: any root commit of any local ref (`rev-list --max-parents=0 --exclude=refs/replace/* --all`, run with `GIT_NO_REPLACE_OBJECTS=1`) equals a project fingerprint, so rewiring the remote does not evade it; (b) *remote*: a configured fetch or push URL (after `insteadOf`), or the URL being pushed, equals a project's canonical repo or an `exact` approved destination by normalized host + repo path (never an owner wildcard: it names an organisation, not a repository); (c) *manual*: the repo's root or its main checkout is in `repos.json`. The spec says `HEAD`; `--all` is deliberate, so removing the branch that holds the first commit does not hide it.
2. **No match is unprotected** (ADR-003). Cannot tell is not "no match": unreadable state, an unlistable policy cache, **any** unusable cached policy (it might be the matching one), two files claiming one project id, or a registration without a policy all **block**. One corrupt policy file therefore blocks pushes in every repo until fixed (`devguard status` says so).
3. **All matches are evaluated; any can block.** With several matching projects the most restrictive (enforce, then client_owned > confidential > internal, then project id) is reported, but every matched project is evaluated and a blocking one is reported if the strictest would have allowed. A more permissive or locally supplied project can never override a stricter one. If evaluation itself fails, the most restrictive project's mode decides.
4. **`register` is a fallback and cannot silently weaken.** The project must already be cached or come with `--policy-file` (local mode; the policy is unverified). A different policy for an already cached project is refused without `--replace-policy`. Everything is validated before anything is written. Registration names the main checkout, so linked worktrees are covered.

## Consequences / honest limits
- Local state is user-owned: `--replace-policy`, editing `policies/` or deleting `repos.json` remain possible, and `register` records no event. Not tamper-proof (security-model.md). AG-6 replaces cached policies from the server.
- A **shallow clone** reports its boundary commits as roots, so fingerprint matching fails there (remote and manual still work). `status` does not warn about it yet.
- Manual registrations compare exact real paths: a moved or re-cloned repo is not matched by its old entry (it can still match by fingerprint or remote); stale entries are not flagged; `repos.json` is read-modify-written without a lock.
- Remote matching needs normalized `canonicalRepos`; AG-6 must normalize on sync.
- Per-push cost grows with the number of cached policies and with history size (`rev-list --all`); there is no git timeout (a failure or timeout blocks).
- "Learning" a fingerprint from a remote match and reporting it to the server is deferred to AG-6/AG-7.
