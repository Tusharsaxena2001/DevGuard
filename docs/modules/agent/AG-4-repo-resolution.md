# AG-4 Repo resolution and project matching (apps/agent)

**Responsibility:** decide which project, if any, a local repo belongs to. Replaces developer-driven registration (ADR-008); manual `register` is a fallback. Supersedes `AG-4-repo-registration.md` (deleted).
**Depends on:** AG-1 (local mode); AG-6 supplies server-synced projects.

## Contract
`resolveRepo(repoPath, projects): {matched: true, projectId, via: 'fingerprint'|'remote'|'manual'} | {matched: false}`
1. **Fingerprint:** compute root commit hash(es) (`git rev-list --max-parents=0 HEAD`); match against project fingerprints.
2. **Remote:** any configured remote normalized (SH-2) equal to a project's canonical repo or approved destination => match; then compute and report the fingerprint (queued event/API call, once AG-5/6 exist) so later remote rewiring is still recognized.
3. **Manual:** entry in local `repos.json` created by `devguard register [path] --project <id> [--policy-file <file>]`; server-validated when online, labeled "unverified" offline/local-only.
4. No match => unprotected (ADR-003).
- Priority if multiple projects match: most restrictive (enforce over audit-only; confidential classification over internal); report all matches.
- Resolution runs in the hook and must be fast (cached; no network).
- Shallow/empty repos or no commits => fingerprint unavailable, remote/manual matching only.
- `devguard unregister` removes only manual entries.
## Local-mode (Gate 1)
Projects come from a local policy file (`--policy-file`), same schema as the server's synced policy, so Gate 1 works with no backend.
## Acceptance
Match by fingerprint after remote swapped to a personal repo; match by remote then fingerprint learned; unmatched repo allowed; multi-match picks most restrictive; moved/symlinked repo; empty repo; manual register round-trip.

## Status: done (decisions and limits: ADR-012)
Implemented: `resolveRepo` (`use-cases/resolve-repo.ts`), `registerRepo`/`unregisterRepo`, `devguard register [path] --project <id> [--policy-file <file>] [--replace-policy]`, `devguard unregister [path]`, and a "This repository" line (and `repository` in `--json`) in `devguard status`. Differences from the text above:
- Fingerprints are the root commits of **all** local refs (`--all`, replace refs ignored), not only `HEAD`.
- The hook evaluates **every** matched project and blocks if any blocks (the most restrictive is reported).
- Remote matching uses canonical repos and `exact` approved destinations, and also counts the URL being pushed. Owner wildcards never match.
- Any unusable cached policy makes the hook block (cannot tell), not only the matching one.
- Deferred: reporting a learned fingerprint (AG-6/7), server validation of manual registrations (AG-5/6), shallow-clone warning in `status`, stale-registration warnings.
