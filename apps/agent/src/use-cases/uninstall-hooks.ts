import { join } from "node:path";
import { AgentError } from "../errors.js";
import { isManaged, PASSTHROUGH_HOOKS } from "./hook-wrapper.js";
import { globalHooksDir, ORIGINAL_SUFFIX, PRE_PUSH } from "./hook-paths.js";
import { loadInstallState, type HookDeps } from "./install-hooks.js";

export interface GlobalUninstallResult {
  readonly status: "removed" | "not_installed";
  /** Notes about things DevGuard deliberately left alone. */
  readonly warnings: string[];
}

export interface RepoUninstallResult {
  readonly status: "removed" | "not_installed";
  readonly restoredOriginal: boolean;
  readonly warnings: string[];
}

const samePath = (a: string, b: string): boolean => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/**
 * Undo the global install: restore the user's previous `core.hooksPath` (or unset it), delete only scripts that carry
 * the DevGuard marker, and forget the record. A `core.hooksPath` the user changed since install is left untouched.
 */
export async function uninstallGlobal(deps: Pick<HookDeps, "store" | "git" | "files">): Promise<GlobalUninstallResult> {
  const { store, git, files } = deps;
  const state = await loadInstallState(store);
  const recorded = state.global;
  if (!recorded) return { status: "not_installed", warnings: [] };

  const warnings: string[] = [];
  const current = await git.globalConfigGet("core.hooksPath");
  if (current !== undefined && samePath(current, recorded.hooksDir)) {
    if (recorded.previousHooksPath === null) await git.globalConfigUnset("core.hooksPath");
    else await git.globalConfigSet("core.hooksPath", recorded.previousHooksPath);
  } else {
    warnings.push(`Global core.hooksPath is now ${current ?? "unset"}, not DevGuard's directory; it was left as it is.`);
  }

  const hooksDir = globalHooksDir(store.location);
  for (const name of [PRE_PUSH, ...PASSTHROUGH_HOOKS]) {
    const path = join(hooksDir, name);
    const content = await files.read(path);
    if (content === undefined) continue;
    if (isManaged(content)) await files.remove(path);
    else warnings.push(`${path} is not a DevGuard script, so it was not removed.`);
  }
  await files.removeDirIfEmpty(hooksDir);

  await store.writeInstall({ repos: state.repos });
  return { status: "removed", warnings };
}

/** Undo a per-repo install: remove the wrapper, move the original hook back, forget the record. */
export async function uninstallRepo(deps: Pick<HookDeps, "store" | "git" | "files">, repoArg: string): Promise<RepoUninstallResult> {
  const { store, git, files } = deps;
  const repoPath = await git.repoRoot(repoArg);
  if (repoPath === undefined) throw new AgentError("usage_error", `${repoArg} is not inside a Git repository.`);

  const state = await loadInstallState(store);
  const hookPath = join(await git.defaultHooksDir(repoPath), PRE_PUSH);
  const original = `${hookPath}${ORIGINAL_SUFFIX}`;
  const content = await files.read(hookPath);

  if (content !== undefined && !isManaged(content)) {
    throw new AgentError("usage_error", `${hookPath} is not a DevGuard hook, so it was left alone.`);
  }
  if (content !== undefined) await files.remove(hookPath);

  let restoredOriginal = false;
  if ((await files.read(original)) !== undefined) {
    try {
      await files.move(original, hookPath);
    } catch (error) {
      // Do not leave the repository without any hook: put DevGuard's wrapper back.
      if (content !== undefined) await files.writeExecutable(hookPath, content).catch(() => undefined);
      throw error;
    }
    restoredOriginal = true;
  }
  const remaining = state.repos.filter((r) => r.repoPath !== repoPath);
  if (remaining.length !== state.repos.length) await store.writeInstall({ ...state, repos: remaining });
  return { status: content === undefined && !restoredOriginal ? "not_installed" : "removed", restoredOriginal, warnings: [] };
}
