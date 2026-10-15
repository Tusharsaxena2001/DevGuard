# Extra verification checks

## Secret hygiene (always)
- `git status`/`git diff` (if repo initialised) contains no `.env`, `*.pem`, `*.key`, tokens, or real credentials.
- Grep changed files for literal secret shapes (AWS key ids, `-----BEGIN ... PRIVATE KEY-----`, `ghp_`, `xox[bp]-`). Synthetic test values must be assembled at runtime (e.g. string concatenation), not written literally.
- Logs/outputs captured during the run contain no tokens or Authorization headers.

## Structure
Spot-check against `.claude/skills/implement-module/structure-checklist.md`: thin entry points, layer boundaries, no Prisma outside repositories, no `fetch` in components, Git only via `GitPort`.

## Per-surface extras
- **agent:** run the real-`git push` integration suite; confirm hook install/uninstall leaves the repo's `.git/hooks` as before.
- **api:** migrations apply to a clean DB (`prisma migrate deploy`); seed is idempotent; OpenAPI builds.
- **dashboard:** production build succeeds; no hardcoded data as a production source.
- **docs:** module spec and roadmap status match what was implemented.

## Claude Code hooks
If `.claude/settings.json` or `.claude/hooks/*` changed: pipe sample JSON into each script and confirm exit codes (see `.claude/hooks/README.md`).
