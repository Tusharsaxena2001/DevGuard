# Claude Code lifecycle hooks

These automate **development with Claude Code**. They are unrelated to the product's Git `pre-push` hook (apps/agent, module AG-2/AG-3). A script in this directory is active only if registered in `.claude/settings.json`.

## Active

| Event | Matcher | Script | Purpose |
|-------|---------|--------|---------|
| PreToolUse | `Write\|Edit` | `block-secret-files.sh` | Blocks writing `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, SSH private key names. Exit 2 blocks and shows stderr to Claude. Fails open on unparseable input (convenience guard, not a security control). |

Contract: hook receives JSON on stdin (`tool_input.file_path`); exit 0 = allow, exit 2 = block with stderr feedback.

Test it:
```
echo '{"tool_input":{"file_path":"/x/.env"}}' | bash .claude/hooks/block-secret-files.sh; echo $?   # 2
echo '{"tool_input":{"file_path":"/x/.env.example"}}' | bash .claude/hooks/block-secret-files.sh; echo $?   # 0
echo '{"tool_input":{"file_path":"/x/src/a.ts"}}' | bash .claude/hooks/block-secret-files.sh; echo $?   # 0
```

## Planned (add when the toolchain exists, not before)

| Event | Matcher | Action | Enable after |
|-------|---------|--------|--------------|
| PostToolUse | `Write\|Edit` | Prettier + ESLint on the single changed file only (fast, no full test suite) | SH-1 (config package exists) |

Rules: hooks must be fast and deterministic; never run the full test suite per edit; document and test each new hook before registering it.
