import type { AgentProject, Classification } from "@devguard/shared";
import { normalizeDestination } from "@devguard/policy-engine";
import type { ConfigStore } from "../ports/config-store.js";
import type { GitPort } from "../ports/git.js";
import { fail, ok, type Result } from "../result.js";

export type ResolveReason = "state_unusable" | "policy_unusable";

/** In priority order: the first that applies is the reported one. */
export type MatchVia = "fingerprint" | "remote" | "manual";
const VIA_ORDER: readonly MatchVia[] = ["fingerprint", "remote", "manual"];

export interface RepoMatch {
  readonly project: AgentProject;
  readonly fetchedAt: string;
  readonly via: MatchVia;
}

export type RepoResolution =
  | { readonly matched: false }
  | {
      readonly matched: true;
      /** The project that governs the push: the most restrictive of `matches`. */
      readonly project: AgentProject;
      readonly fetchedAt: string;
      readonly via: MatchVia;
      /** Every project the repo matched, most restrictive first (the governing one first). */
      readonly matches: readonly { readonly projectId: string; readonly via: MatchVia }[];
      /** The same matches with their policies. The hook evaluates all of them: any one may block. */
      readonly projects: readonly RepoMatch[];
    };

export interface RepoFacts {
  /** Directory the command runs in (Git facts are read here). */
  readonly cwd: string;
  /** Work-tree roots to look up in `repos.json`: the repo itself and, for a linked worktree, its main checkout. */
  readonly repoRoots: readonly string[];
  /** The URL being pushed to (hook only). It counts as a remote of the repo for matching. */
  readonly pushUrl?: string;
}

const CLASSIFICATION_RANK: Record<Classification, number> = { client_owned: 2, confidential: 1, internal: 0 };

/** Most restrictive first: enforce over audit-only, then stricter classification, then project id (deterministic). */
function compareRestrictive(a: RepoMatch, b: RepoMatch): number {
  const mode = Number(b.project.policy.mode === "enforce") - Number(a.project.policy.mode === "enforce");
  if (mode !== 0) return mode;
  const rank = CLASSIFICATION_RANK[b.project.policy.classification] - CLASSIFICATION_RANK[a.project.policy.classification];
  if (rank !== 0) return rank;
  return a.project.projectId < b.project.projectId ? -1 : a.project.projectId > b.project.projectId ? 1 : 0;
}

const key = (host: string, repoPath: string): string => `${host}\0${repoPath}`;

/** Normalized `host`+`repoPath` keys of every URL that parses. A URL that does not parse matches nothing. */
function remoteKeys(urls: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const url of urls) {
    const destination = normalizeDestination(url);
    if (destination.ok) keys.add(key(destination.value.host, destination.value.repoPath));
  }
  return keys;
}

/**
 * Which project, if any, does this repo belong to? Three independent signals (ADR-003/008, AG-4):
 * 1. fingerprint: a root commit equals one of the project's fingerprints, so rewiring the remote does not evade it;
 * 2. remote: a configured remote (or the push URL) is exactly the project's canonical repo or an `exact` approved
 *    destination (never an owner wildcard: that names an organisation, not a repository);
 * 3. manual: the repo's root is listed in `repos.json`.
 * No signal means unprotected. If the agent cannot tell, the result is a failure and the caller must not allow:
 * unreadable state, any unusable cached policy (it might be the matching one), or a registration without a policy.
 * Never touches the network.
 */
export async function resolveRepo(deps: { store: ConfigStore; git: GitPort }, facts: RepoFacts): Promise<Result<RepoResolution, ResolveReason>> {
  const repos = await deps.store.readRepos();
  const ids = await deps.store.listPolicyIds();
  if (!repos.ok || !ids.ok) return fail("state_unusable");

  const cached = new Map<string, { project: AgentProject; fetchedAt: string }>();
  for (const id of ids.value) {
    const policy = await deps.store.readPolicy(id);
    if (!policy.ok || policy.value === undefined) return fail("policy_unusable");
    // Two files claiming one project id: which is authoritative is unknowable, so do not guess.
    if (cached.has(policy.value.project.projectId)) return fail("policy_unusable");
    cached.set(policy.value.project.projectId, { project: policy.value.project, fetchedAt: policy.value.fetchedAt });
  }

  const manualIds = new Set((repos.value?.repos ?? []).filter((r) => facts.repoRoots.includes(r.repoPath)).map((r) => r.projectId));
  for (const id of manualIds) if (!cached.has(id)) return fail("policy_unusable");

  const [roots, urls] = cached.size === 0 ? [[], []] : await Promise.all([deps.git.rootCommits(facts.cwd), deps.git.remoteUrls(facts.cwd)]);
  const fingerprints = new Set(roots);
  const remotes = remoteKeys(facts.pushUrl === undefined ? urls : [...urls, facts.pushUrl]);

  const matches: RepoMatch[] = [];
  for (const { project, fetchedAt } of cached.values()) {
    const via = new Set<MatchVia>();
    if (project.fingerprints.some((f) => fingerprints.has(f))) via.add("fingerprint");
    const identities = [
      ...project.canonicalRepos,
      ...project.policy.destinations.filter((d) => d.type === "exact"),
    ];
    if (identities.some((d) => remotes.has(key(d.host, d.repoPath)))) via.add("remote");
    if (manualIds.has(project.projectId)) via.add("manual");
    const first = VIA_ORDER.find((v) => via.has(v));
    if (first !== undefined) matches.push({ project, fetchedAt, via: first });
  }

  matches.sort(compareRestrictive);
  const chosen = matches[0];
  if (chosen === undefined) return ok({ matched: false });
  return ok({
    matched: true,
    project: chosen.project,
    fetchedAt: chosen.fetchedAt,
    via: chosen.via,
    matches: matches.map((m) => ({ projectId: m.project.projectId, via: m.via })),
    projects: matches,
  });
}
