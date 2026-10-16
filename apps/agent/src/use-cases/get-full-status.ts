import type { ConfigStore } from "../ports/config-store.js";
import type { EventSpool } from "../ports/event-spool.js";
import type { GitPort } from "../ports/git.js";
import type { HookFiles } from "../ports/hook-files.js";
import { getHookStatus, type HookStatus } from "./get-hook-status.js";
import { getRepoProtection, type RepoProtection } from "./get-repo-protection.js";
import { getStatus, type FreshnessCheck, type StatusReport } from "./get-status.js";

export type FullStatusReport = StatusReport & { readonly hooks: HookStatus; readonly repository: RepoProtection };

/** Local state plus hook state plus this repo's protection. Unhealthy if any state file is bad, any hook problem is reported, or protection cannot be determined. */
export async function getFullStatus(deps: { store: ConfigStore; git: GitPort; files: HookFiles; spool?: EventSpool }, cwd: string, freshness?: FreshnessCheck): Promise<FullStatusReport> {
  const [report, hooks, repository] = await Promise.all([getStatus(deps.store, freshness, deps.spool), getHookStatus(deps, cwd), getRepoProtection(deps, cwd)]);
  return { ...report, healthy: report.healthy && hooks.issues.length === 0 && repository.state !== "cannot_tell", hooks, repository };
}
