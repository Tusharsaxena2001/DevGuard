# SH-2 Policy engine — destination (packages/policy-engine)

**Responsibility:** parse/normalize Git remote URLs and evaluate them against an approved-destination list.
**Depends on:** SH-1.

## Contract
- `normalizeDestination(raw: string): {ok:true, value: NormalizedDestination} | {ok:false, reason}`
  Supports `https://host/org/repo(.git)`, `ssh://git@host(:port)/org/repo(.git)`, scp-style `git@host:org/repo(.git)`. Lowercases host, strips `.git` and trailing slashes, collapses default ports, preserves repo path case policy (documented per host; default case-insensitive compare for GitHub-style hosts).
- `isApproved(dest, allowlist): {approved:boolean, matchedEntryId?}` — exact host + repoPath equality (allowlist entries may be `org/*` only if explicitly typed as `owner_wildcard`, still exact host).
## Rejects (ok:false)
Userinfo with host-like tricks (`https://github.com@evil.com/x`), embedded credentials, non-git schemes (`file:`, `ext::`, `http:` unless allowed), empty/whitespace/control characters, path traversal, IDN/punycode lookalikes (compare ASCII/punycode form; reject mixed-script), suffix/prefix lookalikes (`github.com.evil.io`, `evilgithub.com`).
## Implemented semantics (packages/policy-engine/src/destination)
- Files: `normalize.ts` (entry), `host.ts`, `path.ts`, `match.ts`. Exports: `normalizeDestination`, `isApproved`, `isRawDestinationApproved`.
- **Scheme-agnostic identity:** `https://github.com/o/r` and `git@github.com:o/r` are the same destination. The allowlist has no scheme dimension.
- **Ports:** default port is dropped (https 443, ssh 22); any other port is kept as `host:port` and must be spelled in the allowlist entry (ssh on 443 is *not* the https default).
- **Userinfo:** a plain username is discarded; passwords, host-like usernames, usernames not starting alphanumeric (`-v`), and multiple `@` are rejected. Input credentials are never echoed.
- **ASCII only:** all non-ASCII is rejected (no punycode mapping); `xn--` hosts are compared literally and match only an identically spelled entry.
- **Case:** paths are lowercased (and `.git` stripped case-insensitively) only for github.com, gitlab.com, bitbucket.org, dev.azure.com. Elsewhere case is preserved and only a lowercase `.git` suffix is stripped. Residual risk: if one of the four listed hosts were case-sensitive for some path, differently-cased repos would collapse.
- **Paths:** 2 to 10 segments of `[A-Za-z0-9._~-]`; no `.`/`..`/empty segments; no query, fragment, percent-encoding.
- **`owner_wildcard`:** the stored entry is the bare owner/group (`acme-corp`, not `acme-corp/*`, which matches nothing). It matches any strictly deeper path under that owner by whole segments (so GitLab `group/sub/repo` matches `group`), never by string prefix. Unknown entry types match nothing (fail closed).
- Entries are re-canonicalised on match; an entry that fails to normalise matches nothing.
- **Caller assumption (AG-3):** the pure parser cannot see `url.*.insteadOf`/`pushInsteadOf` rewriting or ssh `Host` aliases. The hook must evaluate the URL Git passes as `$2` (the effective push URL, after rewriting) and should additionally report the configured remote URL; ssh config aliases are an accepted limitation (documented in the security model).
## Acceptance
119 tests across `normalize.test.ts` and `match.test.ts` (accepted forms, 50+ rejection cases, lookalikes, wildcard semantics, fail-closed entries, never-throws sweep, case rules). Mutation-checked: replacing exact host equality with `endsWith`, wildcard segment compare with string `startsWith`, allowing multiple `@`, and allowing non-ASCII each made tests fail. Independent security review done (findings fixed).
## Failure behavior
Any parse error => unapproved (fail-safe). Never throws.
