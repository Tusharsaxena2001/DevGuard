import { join } from "node:path";
import { isManaged } from "./hook-wrapper.js";
import type { ConfigStore } from "../ports/config-store.js";
import { safeText } from "../safe-text.js";
import type { GitPort } from "../ports/git.js";
import type { HookFiles } from "../ports/hook-files.js";
import { globalHooksDir, ORIGINAL_SUFFIX, PRE_PUSH } from "./hook-paths.js";

export type GlobalHookState = "not_installed" | "installed" | "drifted";

export interface RepoHookStatus {
  readonly repoPath: string;
  /** A DevGuard pre-push wrapper sits in the repo's default hooks directory. */
  readonly perRepoHook: boolean;
  readonly originalChained: boolean;
  /** The repo sets its own core.hooksPath, so Git does not run DevGuard's hook from the default or global location. */
  readonly overriddenBy?: string;
}

/** Hook state. `issues` are plain-language problems; empty means nothing to fix. */
export interface HookStatus {
  readonly global: GlobalHookState;
  readonly previousHooksPath: string | null;
  readonly repos: readonly RepoHookStatus[];
  readonly issues: readonly string[];
}

const samePath = (a: string, b: string): boolean => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

export async function getHookStatus(
  deps: { store: ConfigStore; git: GitPort; files: HookFiles },
  cwd: string,
): Promise<HookStatus> {
  const { store, git, files } = deps;
  const issues: string[] = [];

  const installRead = await store.readInstall();
  const install = installRead.ok ? (installRead.value ?? { repos: [] }) : undefined;
  if (!install) issues.push("The install record could not be read, so hook state is unknown.");

  let global: GlobalHookState = "not_installed";
  if (install?.global) {
    const current = await git.globalConfigGet("core.hooksPath");
    const wrapper = await files.read(join(globalHooksDir(store.location), PRE_PUSH));
    if (current !== undefined && samePath(current, install.global.hooksDir) && isManaged(wrapper)) global = "installed";
    else {
      global = "drifted";
      issues.push("The global hook was installed but is no longer active (core.hooksPath changed or the script is missing). Run 'devguard install --global' to repair it.");
    }
  }

  const reposRead = await store.readRepos();
  const paths = new Set<string>([
    ...(install?.repos.map((r) => r.repoPath) ?? []),
    ...(reposRead.ok ? (reposRead.value?.repos.map((r) => r.repoPath) ?? []) : []),
  ]);
  const here = await git.repoRoot(cwd).catch(() => undefined);
  if (here !== undefined) paths.add(here);

  const repos: RepoHookStatus[] = [];
  for (const repoPath of [...paths].sort()) {
    const status = await inspectRepo(git, files, repoPath).catch(() => undefined);
    if (!status) continue; // a registered repo that moved or was deleted
    repos.push(status);
    if (status.overriddenBy !== undefined) {
      issues.push(`${safeText(repoPath)} sets core.hooksPath=${safeText(status.overriddenBy)}: Git runs hooks from there, so DevGuard's hook does not run in this repository.`);
    }
  }
  return { global, previousHooksPath: install?.global?.previousHooksPath ?? null, repos, issues };
}

async function inspectRepo(git: GitPort, files: HookFiles, repoPath: string): Promise<RepoHookStatus> {
  const hookPath = join(await git.defaultHooksDir(repoPath), PRE_PUSH);
  const overriddenBy = await git.localConfigGet(repoPath, "core.hooksPath");
  const base = {
    repoPath,
    perRepoHook: isManaged(await files.read(hookPath)),
    originalChained: (await files.read(`${hookPath}${ORIGINAL_SUFFIX}`)) !== undefined,
  };
  return overriddenBy === undefined ? base : { ...base, overriddenBy };
}
