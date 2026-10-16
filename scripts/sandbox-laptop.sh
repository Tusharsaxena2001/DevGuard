#!/usr/bin/env bash
# A throwaway "laptop" for trying DevGuard without touching your real Git setup or home directory.
#
#   source scripts/sandbox-laptop.sh [directory]
#
# Afterwards, in this shell only:
#   - HOME, the global Git config and the DevGuard state point inside the sandbox (your real ones are untouched);
#   - `devguard` runs the built agent (build it first: pnpm --filter @devguard/agent build);
#   - two bare repos stand in for remotes: git@github.com:acme/portal.git (the "approved" one) and
#     git@github.com:personal/fork.git (a "personal" one). Pushes to those URLs land in local bare repos.
#   - ~/work/portal is a repo with `origin` = the acme remote and a `fork` remote = the personal one.
# Stop using it by closing the shell, or run: sandbox_cleanup

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "Run this with: source scripts/sandbox-laptop.sh" >&2
  exit 1
fi

DEVGUARD_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="${1:-$(mktemp -d "${TMPDIR:-/tmp}/devguard-laptop.XXXXXX")}"
mkdir -p "$SANDBOX/home" "$SANDBOX/remotes" "$SANDBOX/work"

# Git reaches `git@github.com:owner/repo.git` through ssh; this fake ssh serves the bare repos instead.
cat > "$SANDBOX/fake-ssh" <<SSH
#!/bin/sh
cd '$SANDBOX/remotes' && exec sh -c "\$2"
SSH
chmod +x "$SANDBOX/fake-ssh"

export HOME="$SANDBOX/home"
export GIT_CONFIG_GLOBAL="$SANDBOX/home/.gitconfig"
export GIT_CONFIG_NOSYSTEM=1
export XDG_CONFIG_HOME="$SANDBOX/xdg"
export GIT_SSH_COMMAND="$SANDBOX/fake-ssh"
export DEVGUARD_HOME="$SANDBOX/state"
export GIT_AUTHOR_NAME="Sandbox Dev" GIT_AUTHOR_EMAIL="dev@example.test"
export GIT_COMMITTER_NAME="Sandbox Dev" GIT_COMMITTER_EMAIL="dev@example.test"

for remote in acme/portal personal/fork; do
  [ -d "$SANDBOX/remotes/$remote.git" ] || { mkdir -p "$SANDBOX/remotes/$remote.git" && git init -q --bare "$SANDBOX/remotes/$remote.git"; }
done
if [ ! -d "$SANDBOX/work/portal/.git" ]; then
  git init -q -b main "$SANDBOX/work/portal"
  git -C "$SANDBOX/work/portal" remote add origin git@github.com:acme/portal.git
  git -C "$SANDBOX/work/portal" remote add fork git@github.com:personal/fork.git
  echo "hello" > "$SANDBOX/work/portal/README.md"
  git -C "$SANDBOX/work/portal" add README.md
  git -C "$SANDBOX/work/portal" commit -q -m "first commit"
fi

devguard() { node "$DEVGUARD_REPO_ROOT/apps/agent/dist/main.js" "$@"; }
sandbox_cleanup() { rm -rf "$SANDBOX"; echo "removed $SANDBOX"; }

cd "$SANDBOX/work/portal"
echo "Sandbox laptop ready: $SANDBOX"
echo "  repo:   $SANDBOX/work/portal   (origin = git@github.com:acme/portal.git, fork = git@github.com:personal/fork.git)"
echo "  state:  $DEVGUARD_HOME"
echo "  try:    devguard status"
