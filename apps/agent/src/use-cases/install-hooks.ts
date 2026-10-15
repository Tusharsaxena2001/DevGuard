import { AgentError } from "../errors.js";
import { safeText } from "../safe-text.js";
import type { AgentLocation } from "../ports/agent-location.js";
import type { Clock } from "../ports/clock.js";
import type { ConfigStore } from "../ports/config-store.js";
import type { GitPort } from "../ports/git.js";
import type { HookFiles } from "../ports/hook-files.js";
import type { InstallState } from "../ports/local-state.js";
import { isManaged, PASSTHROUGH_HOOKS, renderPassthrough, renderPrePushWrapper } from "./hook-wrapper.js";
import { globalHooksDir, ORIGINAL_SUFFIX, PRE_PUSH } from "./hook-paths.js";
import { join } from "node:path";

export interface HookDeps {
  readonly store: ConfigStore;
  readonly git: GitPort;
  readonly files: HookFiles;
  readonly clock: Clock;
  readonly agent: AgentLocation;
}

export type InstallStatus = "installed" | "updated" | "already_installed";

export interface GlobalInstallResult {
  readonly status: InstallStatus;
  readonly hooksDir: string;
  /** The user's own global core.hooksPath that DevGuard chains to, if any. */
  readonly previousHooksPath: string | null;
}

export interface RepoInstallResult {
  readonly status: InstallStatus;
  readonly repoPath: string;
  readonly hookPath: string;
  readonly chainedOriginal: boolean;
}

export async function loadInstallState(store: ConfigStore): Promise<InstallState> {
  const read = await store.readInstall();
  if (!read.ok) throw new AgentError("config_invalid", `DevGuard's install record is ${read.reason === "insecure_permissions" ? "not private enough to trust" : "unusable"}. Run 'devguard status', fix or delete ${join(store.location, "install.json")}, and try again.`);
  return read.value ?? { repos: [] };
}

/**
 * Resolve the user's previous global `core.hooksPath` to the directory the wrapper chains to. Git expands `~` and `~/`;
 * the `~user` form and an empty value cannot be chained safely, so they are refused (before anything is written)
 * rather than silently dropping the user's own hooks.
 */
function chainDirectory(previous: string | null, home: string | undefined): string | null {
  if (previous === null) return null;
  if (previous.trim() === "") {
    throw new AgentError("usage_error", "Your global core.hooksPath is set but empty. Unset it or give it a value, then run 'devguard install --global' again.");
  }
  if (previous === "~" || previous.startsWith("~/")) {
    if (home === undefined) throw new AgentError("usage_error", `Cannot expand ~ in your global core.hooksPath (${safeText(previous)}) without a home directory.`);
    return previous === "~" ? home : join(home, previous.slice(2));
  }
  if (previous.startsWith("~")) {
    throw new AgentError("usage_error", `DevGuard cannot chain to your global core.hooksPath (${safeText(previous)}) because it uses the ~user form. Use an absolute path, then run 'devguard install --global' again.`);
  }
  return previous;
}

const samePath = (a: string, b: string): boolean => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

async function writeIfChanged(files: HookFiles, path: string, content: string): Promise<boolean> {
  if ((await files.read(path)) === content) return false;
  await files.writeExecutable(path, content);
  return true;
}

/**
 * Install the managed hooks directory and point the user's global `core.hooksPath` at it.
 * Order matters for crash safety: scripts first, then the record of what to restore, then the Git setting last, so a
 * failure part-way can always be uninstalled and never loses the user's previous value.
 */
export async function installGlobal(deps: HookDeps, userHome: string | undefined): Promise<GlobalInstallResult> {
  const { store, git, files, clock, agent } = deps;
  const state = await loadInstallState(store);
  const hooksDir = globalHooksDir(store.location);
  const current = await git.globalConfigGet("core.hooksPath");

  const alreadyOurs = current !== undefined && samePath(current, hooksDir);
  const previous = current !== undefined && !alreadyOurs ? current : (state.global?.previousHooksPath ?? null);
  const previousDir = chainDirectory(previous, userHome);

  let changed = false;
  changed = (await writeIfChanged(files, join(hooksDir, PRE_PUSH), renderPrePushWrapper({ agent, devguardHome: store.location, mode: { kind: "global", previousHooksDir: previousDir } }))) || changed;
  for (const name of PASSTHROUGH_HOOKS) {
    changed = (await writeIfChanged(files, join(hooksDir, name), renderPassthrough(name, previousDir))) || changed;
  }

  const recorded = state.global;
  const stateChanged = !recorded || recorded.hooksDir !== hooksDir || recorded.previousHooksPath !== previous;
  if (stateChanged) {
    await store.writeInstall({ ...state, global: { hooksDir, previousHooksPath: previous, installedAt: clock.now().toISOString() } });
  }
  if (!alreadyOurs) await git.globalConfigSet("core.hooksPath", hooksDir);

  const status: InstallStatus = !alreadyOurs || stateChanged ? (recorded ? "updated" : "installed") : changed ? "updated" : "already_installed";
  return { status, hooksDir, previousHooksPath: previous };
}

/**
 * Install the wrapper into one repository's own hooks directory. An existing pre-push hook is moved aside (mode
 * preserved by the rename) and chained to. Refused where the repo sets its own `core.hooksPath` (e.g. husky): Git
 * would not run a hook placed in the default directory.
 */
export async function installRepo(deps: HookDeps, repoArg: string): Promise<RepoInstallResult> {
  const { store, git, files, clock, agent } = deps;
  const repoPath = await git.repoRoot(repoArg);
  if (repoPath === undefined) throw new AgentError("usage_error", `${repoArg} is not inside a Git repository.`);

  const localHooksPath = await git.localConfigGet(repoPath, "core.hooksPath");
  if (localHooksPath !== undefined) {
    throw new AgentError("usage_error", `This repository sets core.hooksPath (${safeText(localHooksPath)}), so a hook in the default location would never run. DevGuard cannot install a per-repo hook here; the global install is also overridden by this setting.`);
  }

  const state = await loadInstallState(store);
  const hooksDir = await git.defaultHooksDir(repoPath);
  const hookPath = join(hooksDir, PRE_PUSH);
  const original = `${hookPath}${ORIGINAL_SUFFIX}`;

  const existing = await files.read(hookPath);
  let moved = false;
  if (existing !== undefined && !isManaged(existing)) {
    if ((await files.read(original)) !== undefined) {
      throw new AgentError("usage_error", `${hookPath} is not a DevGuard hook and ${original} already exists, so DevGuard will not overwrite either. Resolve this by hand and try again.`);
    }
    await files.move(hookPath, original);
    moved = true;
  }

  let wrote: boolean;
  try {
    wrote = await writeIfChanged(files, hookPath, renderPrePushWrapper({ agent, devguardHome: store.location, mode: { kind: "repo", originalHook: original, hookPath } }));
  } catch (error) {
    // Never leave the repository with the user's hook moved aside and no hook in its place.
    if (moved) await files.move(original, hookPath).catch(() => undefined);
    throw error;
  }
  const chainedOriginal = (await files.read(original)) !== undefined;

  const known = state.repos.find((r) => r.repoPath === repoPath);
  if (!known) {
    await store.writeInstall({ ...state, repos: [...state.repos, { repoPath, hooksDir, installedAt: clock.now().toISOString() }] });
  }
  const status: InstallStatus = !known ? "installed" : wrote ? "updated" : "already_installed";
  return { status, repoPath, hookPath, chainedOriginal };
}

