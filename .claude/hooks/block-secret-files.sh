#!/usr/bin/env bash
# Claude Code PreToolUse hook (Write|Edit): refuse to write real env/key files.
# Reads the hook JSON on stdin. Exit 2 = block (stderr is shown to Claude). Exit 0 = allow.
# This is a development guardrail for Claude Code only — NOT the product's Git pre-push hook.
set -u

input="$(cat)"
path="$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"

# Fail open on unparseable input: this guard is a convenience, not a security control.
[ -z "$path" ] && exit 0

base="${path##*/}"
case "$base" in
  .env.example) exit 0 ;;
  .env|.env.*|*.pem|*.key|id_rsa|id_ed25519)
    echo "Blocked: refusing to write '$base'. Secrets/env files must be created by the user locally; use .env.example with placeholders." >&2
    exit 2
    ;;
esac
exit 0
