import type { ConfigStore } from "../ports/config-store.js";
import type { GitPort } from "../ports/git.js";
import type { HookFiles } from "../ports/hook-files.js";
import { getHookStatus, type HookStatus } from "./get-hook-status.js";
import { getRepoProtection, type RepoProtection } from "./get-repo-protection.js";
import { getStatus, type StatusReport } from "./get-status.js";

export type FullStatusReport = StatusReport & { readonly hooks: HookStatus; readonly repository: RepoProtection };

/** Local state plus hook state plus this repo's protection. Unhealthy if any state file is bad, any hook problem is reported, or protection cannot be determined. */
export async function getFullStatus(deps: { store: ConfigStore; git: GitPort; files: HookFiles }, cwd: string): Promise<FullStatusReport> {
  const [report, hooks, repository] = await Promise.all([getStatus(deps.store), getHookStatus(deps, cwd), getRepoProtection(deps, cwd)]);
  return { ...report, healthy: report.healthy && hooks.issues.length === 0 && repository.state !== "cannot_tell", hooks, repository };
}
