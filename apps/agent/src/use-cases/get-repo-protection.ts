import type { ConfigStore } from "../ports/config-store.js";
import type { GitPort } from "../ports/git.js";
import { resolveRepo, type MatchVia, type ResolveReason } from "./resolve-repo.js";

export type RepoProtection =
  | { readonly state: "not_a_repo" }
  | { readonly state: "unprotected" }
  | {
      readonly state: "protected";
      readonly projectId: string;
      readonly projectName: string;
      readonly mode: "enforce" | "audit_only";
      readonly via: MatchVia;
      readonly otherMatches: number;
    }
  | { readonly state: "cannot_tell"; readonly reason: ResolveReason };

/** Would a push from the current directory be protected, and why? Same resolution the hook uses. */
export async function getRepoProtection(deps: { store: ConfigStore; git: GitPort }, cwd: string): Promise<RepoProtection> {
  const repoRoot = await deps.git.repoRoot(cwd);
  if (repoRoot === undefined) return { state: "not_a_repo" };
  const mainRoot = await deps.git.mainWorktreeRoot(cwd);
  const resolved = await resolveRepo(deps, { cwd, repoRoots: mainRoot === undefined ? [repoRoot] : [repoRoot, mainRoot] });
  if (!resolved.ok) return { state: "cannot_tell", reason: resolved.reason };
  if (!resolved.value.matched) return { state: "unprotected" };
  const { project, via, matches } = resolved.value;
  return { state: "protected", projectId: project.projectId, projectName: project.name, mode: project.policy.mode, via, otherMatches: matches.length - 1 };
}
