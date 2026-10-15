import { AgentError } from "../errors.js";
import type { AgentLocation } from "../ports/agent-location.js";

/** Present in every script DevGuard writes; uninstall refuses to touch a hook that lacks it. */
export const MARKER = "DEVGUARD-MANAGED-HOOK";

/** Client-side Git hooks other than pre-push. A global `core.hooksPath` hides every repo's own hooks, so each of these is passed through. */
export const PASSTHROUGH_HOOKS: readonly string[] = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "post-rewrite",
  "pre-auto-gc",
  "reference-transaction",
  "post-index-change",
  "fsmonitor-watchman",
  "sendemail-validate",
  "push-to-checkout",
  // A global core.hooksPath also hides the hooks of a local repository that receives a push.
  "pre-receive",
  "update",
  "proc-receive",
  "post-receive",
  "post-update",
  "p4-changelist",
  "p4-prepare-changelist",
  "p4-post-changelist",
  "p4-pre-submit",
];

/** Managed scripts carry the marker as their second line (after the shebang); a file that merely mentions it is not ours. */
export function isManaged(content: string | undefined): boolean {
  return content?.split("\n")[1]?.startsWith(`# ${MARKER}`) === true;
}

/** Shell helper shared by the generated scripts: is this hook one of ours? (same second-line rule as `isManaged`) */
const IS_MANAGED_FN = `dg_is_managed() {
  sed -n 2p "$1" 2>/dev/null | grep -q '^# ${MARKER}'
}`;

/** Single-quote a value for POSIX sh. Newlines and NULs cannot be quoted safely, so they are rejected. */
export function shellQuote(value: string): string {
  if (/[\n\r\0]/.test(value)) throw new AgentError("hook_files_failed", "A path contains a newline or NUL and cannot be used in a hook.");
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export type WrapperMode =
  /** Global `core.hooksPath` install. Chains to the user's previous hooks directory, or else the repo's own hook. */
  | { readonly kind: "global"; readonly previousHooksDir: string | null }
  /** Per-repo install. Chains to the original hook that was moved aside. */
  | { readonly kind: "repo"; readonly originalHook: string; readonly hookPath: string };

export interface WrapperOptions {
  readonly agent: AgentLocation;
  readonly devguardHome: string;
  readonly mode: WrapperMode;
}

function missingAgentMessage(mode: WrapperMode): string {
  const remedy =
    mode.kind === "global"
      ? "To remove the DevGuard hook: git config --global --unset core.hooksPath (then restore your previous core.hooksPath, if you had one)"
      : `To remove the DevGuard hook: delete ${mode.hookPath} (your original hook is saved next to it as ${mode.originalHook})`;
  return `DevGuard: the agent was not found, so this push was blocked (it cannot tell whether the repository is protected). Reinstall DevGuard, or remove the hook. ${remedy}`;
}

/**
 * The `pre-push` wrapper. It pins `DEVGUARD_HOME` and the absolute paths of node and the agent at install time (so a
 * different environment or `PATH` at push time cannot swap in other state or another binary), runs the agent with
 * stdin passed through, and only if the agent allows, chains to the user's own hook with the same arguments and stdin.
 * Any non-zero exit from the agent blocks the push.
 */
export function renderPrePushWrapper(options: WrapperOptions): string {
  const { agent, devguardHome, mode } = options;
  const chain =
    mode.kind === "global"
      ? mode.previousHooksDir !== null
        ? `dg_chain ${shellQuote(`${mode.previousHooksDir.replace(/\/$/, "")}/pre-push`)} "$@"`
        : 'dg_chain "$(git rev-parse --git-common-dir 2>/dev/null)/hooks/pre-push" "$@"'
      : `dg_chain ${shellQuote(mode.originalHook)} "$@"`;

  return `#!/bin/sh
# ${MARKER} v1 agent=${agent.version}
# Written by \`devguard install\`. Do not edit; remove it with \`devguard uninstall\`.
DEVGUARD_HOME=${shellQuote(devguardHome)}
export DEVGUARD_HOME
DG_NODE=${shellQuote(agent.nodePath)}
DG_MAIN=${shellQuote(agent.mainPath)}

if [ ! -x "$DG_NODE" ] || [ ! -f "$DG_MAIN" ]; then
  echo ${shellQuote(missingAgentMessage(mode))} >&2
  exit 1
fi

DG_IN=$(mktemp) || exit 1
trap 'rm -f "$DG_IN"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
cat > "$DG_IN"

# "--" so a remote name or URL that looks like an option (e.g. -h) is never parsed as one.
"$DG_NODE" "$DG_MAIN" hook pre-push -- "$@" < "$DG_IN" || exit $?

${IS_MANAGED_FN}
dg_chain() {
  dg_hook=$1
  shift
  if [ -f "$dg_hook" ] && [ -x "$dg_hook" ] && ! dg_is_managed "$dg_hook"; then
    "$dg_hook" "$@" < "$DG_IN" || exit $?
  fi
}
${chain}
exit 0
`;
}

/** A hook DevGuard does not handle: hand over to the hook that would have run without DevGuard. */
export function renderPassthrough(hookName: string, previousHooksDir: string | null): string {
  const target =
    previousHooksDir !== null
      ? shellQuote(`${previousHooksDir.replace(/\/$/, "")}/${hookName}`)
      : `"$(git rev-parse --git-common-dir 2>/dev/null)/hooks/${hookName}"`;
  return `#!/bin/sh
# ${MARKER} v1 passthrough
# DevGuard sets a global core.hooksPath, which would otherwise disable this hook. Written by \`devguard install\`.
${IS_MANAGED_FN}
dg_hook=${target}
if [ -f "$dg_hook" ] && [ -x "$dg_hook" ] && ! dg_is_managed "$dg_hook"; then
  exec "$dg_hook" "$@"
fi
exit 0
`;
}
