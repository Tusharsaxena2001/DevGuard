import { safeText } from "../safe-text.js";
import type { GlobalInstallResult, RepoInstallResult } from "../use-cases/install-hooks.js";
import type { GlobalUninstallResult, RepoUninstallResult } from "../use-cases/uninstall-hooks.js";
import type { HookStatus } from "../use-cases/get-hook-status.js";

const LIMITS = [
  "Limits: a repository that sets its own core.hooksPath (for example husky) overrides this hook, and 'git push --no-verify' skips it. DevGuard reports the first, it cannot prevent either.",
];

export function formatGlobalInstall(result: GlobalInstallResult): string[] {
  const head =
    result.status === "already_installed" ? "DevGuard's global hook is already installed." : result.status === "updated" ? "DevGuard's global hook was updated." : "DevGuard's global hook is installed.";
  return [
    head,
    `  Hooks directory: ${safeText(result.hooksDir)}`,
    ...(result.previousHooksPath === null ? [] : [`  Your previous core.hooksPath (${safeText(result.previousHooksPath)}) is kept and its hooks still run after DevGuard allows a push.`]),
    "  Other Git hooks keep working: DevGuard passes them through to your repository's own hooks.",
    "  Protection applies to repositories assigned to a project (register one manually with a local policy while the server is not connected).",
    ...LIMITS,
  ];
}

export function formatRepoInstall(result: RepoInstallResult): string[] {
  const head = result.status === "already_installed" ? "DevGuard's hook is already installed in this repository." : "DevGuard's hook is installed in this repository.";
  return [head, `  Hook: ${safeText(result.hookPath)}`, ...(result.chainedOriginal ? ["  Your existing pre-push hook was kept (as pre-push.devguard-orig) and still runs after DevGuard allows a push."] : []), ...LIMITS];
}

export function formatGlobalUninstall(result: GlobalUninstallResult): string[] {
  const head = result.status === "not_installed" ? "DevGuard's global hook is not installed." : "DevGuard's global hook was removed and your previous Git configuration restored.";
  return [head, ...result.warnings.map((w) => `  Note: ${w}`)];
}

export function formatRepoUninstall(result: RepoUninstallResult): string[] {
  const head = result.status === "not_installed" ? "DevGuard's hook is not installed in this repository." : "DevGuard's hook was removed from this repository.";
  return [head, ...(result.restoredOriginal ? ["  Your original pre-push hook was restored."] : []), ...result.warnings.map((w) => `  Note: ${w}`)];
}

const GLOBAL_TEXT = { not_installed: "not installed", installed: "installed", drifted: "NOT ACTIVE (see below)" } as const;

export function formatHookStatusText(hooks: HookStatus): string[] {
  const lines = [`Global hook: ${GLOBAL_TEXT[hooks.global]}`];
  if (hooks.previousHooksPath !== null) lines.push(`  Chains to your previous core.hooksPath: ${safeText(hooks.previousHooksPath)}`);
  const interesting = hooks.repos.filter((r) => r.perRepoHook || r.overriddenBy !== undefined);
  if (interesting.length > 0) {
    lines.push("Repositories:");
    for (const repo of interesting) {
      const notes = [repo.perRepoHook ? "per-repo hook installed" : "", repo.overriddenBy === undefined ? "" : `OVERRIDDEN by core.hooksPath=${safeText(repo.overriddenBy)}`].filter(Boolean);
      lines.push(`  ${safeText(repo.repoPath)}: ${notes.join("; ")}`);
    }
  }
  for (const issue of hooks.issues) lines.push(`Problem: ${safeText(issue)}`);
  return lines;
}
