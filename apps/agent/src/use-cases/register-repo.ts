import { isDeepStrictEqual } from "node:util";
import { AgentProjectSchema, type AgentProject } from "@devguard/shared";
import { AgentError } from "../errors.js";
import type { Clock } from "../ports/clock.js";
import type { ConfigStore } from "../ports/config-store.js";
import type { GitPort } from "../ports/git.js";
import { isSafeProjectId } from "../ports/local-state.js";
import type { PolicyFileReader } from "../ports/policy-file.js";

export interface RegisterDeps {
  readonly store: ConfigStore;
  readonly git: GitPort;
  readonly policyFile: PolicyFileReader;
  readonly clock: Clock;
}

export interface RegisterRequest {
  readonly path: string;
  readonly projectId?: string;
  readonly policyFile?: string;
  /** Allow `policyFile` to replace a different policy already cached for the same project. */
  readonly replacePolicy?: boolean;
}

export interface RegisterResult {
  readonly repoPath: string;
  readonly projectId: string;
  readonly projectName: string;
  /** A policy was read from `--policy-file` and cached (local mode, no server: the policy is unverified). */
  readonly policyCached: boolean;
  readonly alreadyRegistered: boolean;
}

/** The root a registration names: the main checkout (so its linked worktrees are covered), or the repo itself. */
async function registrationRoot(git: GitPort, path: string): Promise<string> {
  const root = (await git.mainWorktreeRoot(path)) ?? (await git.repoRoot(path));
  if (root === undefined) throw new AgentError("usage_error", "That path is not inside a Git repository.");
  return root;
}

/**
 * Manual fallback for repos the agent does not recognise by itself (ADR-003/008). The project must already be known
 * (cached from the server) or come with `--policy-file` (local mode: a project in the shape the server syncs). A repo
 * can never be registered to a project DevGuard has no policy for: that would be a protected repo with nothing to enforce.
 */
export async function registerRepo(deps: RegisterDeps, request: RegisterRequest): Promise<RegisterResult> {
  const repoPath = await registrationRoot(deps.git, request.path);
  const now = deps.clock.now().toISOString();

  // Everything that can fail is checked before anything is written, so a failed registration changes nothing.
  const repos = await deps.store.readRepos();
  if (!repos.ok) throw new AgentError("config_invalid", "DevGuard's list of registered repositories could not be read; run 'devguard status'.");
  const existing = repos.value?.repos ?? [];

  let projectId = request.projectId;
  let projectName: string;
  let toCache: AgentProject | undefined;
  let policyCached = false;

  if (request.policyFile !== undefined) {
    const file = await deps.policyFile.read(request.policyFile);
    if (!file.ok) throw new AgentError("usage_error", `The policy file could not be used (${file.reason.replace("_", " ")}).`);
    const parsed = AgentProjectSchema.safeParse(file.value);
    if (!parsed.success) throw new AgentError("usage_error", "The policy file is not a valid DevGuard project policy.");
    const project = parsed.data;
    if (projectId !== undefined && projectId !== project.projectId) {
      throw new AgentError("usage_error", "--project does not match the project id inside the policy file.");
    }
    if (!isSafeProjectId(project.projectId)) {
      throw new AgentError("usage_error", "The project id may only contain letters, digits, '-' and '_'.");
    }
    const current = await deps.store.readPolicy(project.projectId);
    if (!current.ok) throw new AgentError("config_invalid", "DevGuard's local state could not be read; run 'devguard status'.");
    if (current.value !== undefined && !isDeepStrictEqual(current.value.project, project) && request.replacePolicy !== true) {
      throw new AgentError(
        "usage_error",
        "DevGuard already has a different policy for that project. Add --replace-policy to overwrite it (a policy synced from the server is replaced the next time it syncs).",
      );
    }
    toCache = project;
    projectId = project.projectId;
    projectName = project.name;
  } else {
    if (projectId === undefined) throw new AgentError("usage_error", "Say which project: --project <id> (or --policy-file <file> for local use).");
    if (!isSafeProjectId(projectId)) throw new AgentError("usage_error", "The project id may only contain letters, digits, '-' and '_'.");
    const cached = await deps.store.readPolicy(projectId);
    if (!cached.ok) throw new AgentError("config_invalid", "DevGuard's local state could not be read; run 'devguard status'.");
    if (cached.value === undefined) {
      throw new AgentError("usage_error", "DevGuard has no policy for that project on this device. Provide one with --policy-file <file>.");
    }
    projectName = cached.value.project.name;
  }

  if (toCache !== undefined) {
    policyCached = true;
    await deps.store.writePolicy({ fetchedAt: now, project: toCache, source: "local" });
  }
  const alreadyRegistered = existing.some((r) => r.repoPath === repoPath && r.projectId === projectId);
  if (!alreadyRegistered) {
    await deps.store.writeRepos({ repos: [...existing, { repoPath, projectId, registeredAt: now }] });
  }
  return { repoPath, projectId, projectName, policyCached, alreadyRegistered };
}

export interface UnregisterResult {
  readonly repoPath: string;
  readonly removed: number;
}

/** Removes only manual registrations for this repo. Repos matched by fingerprint or remote stay protected. */
export async function unregisterRepo(deps: Pick<RegisterDeps, "store" | "git">, path: string): Promise<UnregisterResult> {
  const repoPath = await registrationRoot(deps.git, path);
  const repos = await deps.store.readRepos();
  if (!repos.ok) throw new AgentError("config_invalid", "DevGuard's list of registered repositories could not be read; run 'devguard status'.");
  const existing = repos.value?.repos ?? [];
  const kept = existing.filter((r) => r.repoPath !== repoPath);
  if (kept.length !== existing.length) await deps.store.writeRepos({ repos: kept });
  return { repoPath, removed: existing.length - kept.length };
}
