# SH-3 Policy engine — content rules (packages/policy-engine)

**Responsibility:** detect prohibited files and high-confidence secrets in an outgoing-change summary.
**Depends on:** SH-1.

## Contract
- `findProhibitedFiles(paths: {path, commit}[], globs): Finding[]` — default globs: `.env`, `.env.*` (not `.env.example`), `*.pem`, `*.key`, `id_rsa*`, `*.p12`, `*.pfx`, `.npmrc` with auth lines (path-only rule), `credentials.json`, `*.kdbx`. Configurable per policy.
- `scanAddedLines(lines: {path, commit, text}[], rules): Finding[]` — minimal detector per ADR-005. `text` is input only; findings carry `ruleId`, `kind`, `path`, `commit`, line number optional — **never the matched text**.
## Documented coverage (README + this file)
Private key PEM headers; AWS access key id (`AKIA`/`ASIA` + 16); GitHub tokens (`ghp_`, `gho_`, `github_pat_`); Slack tokens (`xox[baprs]-`); generic provider-prefixed tokens. Not covered: arbitrary high-entropy strings, passwords, binary files, obfuscated secrets.
## Implemented semantics (packages/policy-engine/src/content)
- Files: `glob.ts` (non-backtracking matcher), `prohibited-files.ts`, `secret-rules.ts`, `scan.ts`. Exports: `findProhibitedFiles`, `DEFAULT_PROHIBITED_GLOBS`, `scanAddedLines`, `SECRET_RULES`, `DEFAULT_SECRET_RULE_IDS`.
- **Globs:** case-insensitive. No `/` in the pattern => matches basename at any depth; with `/` => full repo-relative path. `*`/`?` stop at `/`, `**` crosses it, `/**/` matches zero or more directories (`a/**/b` matches `a/b`), leading `**/` also matches at root, leading `/` anchors to root. A `!` prefix exempts matching paths and always wins. Empty pattern matches nothing. **Unsupported syntax** (`[..]`, `{..}`, `\`, trailing `/`) would silently never fire, so `findProhibitedFiles` returns one `scan_error` finding (attributed to the first file) instead; API-4 should also reject such globs at save time. Globs are used exactly as given: an empty list prohibits nothing (the server seeds policies with the defaults).
- **Default globs** are the spec list plus `id_ed25519*`, `id_ecdsa*`, `id_dsa*`, exemptions `!.env.example` and `!id_*.pub` (public keys are not secret).
- **`.npmrc` is path-only:** every `.npmrc` is flagged, not just ones with auth lines (content is not inspected by this rule). Over-blocking by design; admins can exempt via `!` globs.
- Prohibited-file findings: `ruleId: "prohibited_file"`, one per (commit, path). Callers decide which changed files to pass in (e.g. whether deleted files count).
- **Secret rule ids:** `private_key_block`, `aws_access_key_id`, `github_token`, `slack_token`, `provider_token` (Stripe `sk_live_`/`rk_live_`, Google `AIza`, npm `npm_`, GitLab `glpat-`, SendGrid `SG.`). `rules` argument is the policy's `secretRules` id list (empty => no secret scanning). Findings use the specific rule id with `kind: "secret"`; at most one per (rule, commit, path, line).
- **Fail-safe:** with no input lines there is nothing to scan, so an unknown id yields nothing. An enabled rule id the engine does not know, or a rule that throws, yields `ruleId: "scan_error"`, `kind: "scan_error"` (block in enforce mode, decided in SH-4). An unknown-id error is attributed to the first scanned line. Error text is never included.
- The rule catalog is an injectable parameter (adapter seam for ADR-005's post-MVP revisit).
- **Known limitations:** exemptions are filename-based, so a developer can name a real env file `.env.example` (or a key `id_x.pub`) and the path rule will not fire; private keys are still caught by `private_key_block`, but env files with passwords are not. `.env.sample`/`.env.template` are flagged (over-blocking). NTFS name tricks (`.env `, `::$DATA`) are not normalised.
- **Caller contract (AG-3):** paths must be repo-relative, `/`-separated, unquoted (use `git ... -z`, since default `core.quotePath` wraps odd names in quotes and breaks matching), with no leading `./`. Do not pass deleted files: the commit that adds a prohibited file is flagged (so added-then-deleted is still caught), and the commit that removes it must not be blocked (ADR-011 #7). Skip or cap pathological line lengths and binary files; this is documented, not detected.
## Acceptance
309 tests in the policy-engine package (content: glob, prohibited-files, scan). Synthetic values built at runtime; false-positive tests (`.env.example`, docs mentioning formats); findings contain no matched substring (assert); boundary pairs per rule; adversarial-length performance tests. Mutation-checked (exemption removal, AWS boundary, `?` crossing `/`, unknown-rule error, case folding each fail tests). Independent security and test reviews done; findings fixed or documented above.
## Failure behavior
Detector exception => error finding `scan_error` that causes block in enforce mode.
