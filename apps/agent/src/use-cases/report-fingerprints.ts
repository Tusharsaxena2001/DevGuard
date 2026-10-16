import { normalizeDestination } from "@devguard/policy-engine";
import type { AgentProject } from "@devguard/shared";
import type { ApiClient } from "../ports/api-client.js";
import type { ConfigStore } from "../ports/config-store.js";
import type { GitPort } from "../ports/git.js";
import { loadEnrollment } from "./load-enrollment.js";
import type { RepoMatch } from "./resolve-repo.js";

export interface ReportDeps {
  readonly store: ConfigStore;
  readonly git: GitPort;
  readonly api: ApiClient;
}

/**
 * ADR-008: a repo recognised only by its remote teaches the server its root commits, so later a changed remote
 * still resolves to the same project. Reports at most one unknown root commit per matching project per push, best effort,
 * and only for server-synced projects. Sends the normalized host and repo path (never the raw URL, which may contain credentials) as the evidence the server checks against the project.
 */
export async function reportNewFingerprints(deps: ReportDeps, matches: readonly RepoMatch[], pushUrl: string, cwd: string): Promise<number> {
  const learnable = matches.filter((m) => m.via === "remote" && m.source === "server");
  if (learnable.length === 0) return 0;
  // Never send the raw URL: it can carry a username that is really a token. Host + repo path is all the server needs.
  const destination = normalizeDestination(pushUrl);
  if (!destination.ok) return 0;
  const remote = `https://${destination.value.host}/${destination.value.repoPath}`;
  const enrollment = await loadEnrollment(deps.store);
  if (!enrollment.ok) return 0;
  const roots = await deps.git.rootCommits(cwd);
  let sent = 0;
  for (const { project } of learnable) {
    for (const fingerprint of unknownRoots(project, roots)) {
      const result = await deps.api.reportFingerprint(enrollment.value, { projectId: project.projectId, fingerprint, remote });
      if (result.ok) sent += 1;
    }
  }
  return sent;
}

/** One per push per project keeps the hook fast; the next push reports the next one. */
const MAX_PER_PROJECT = 1;

function unknownRoots(project: AgentProject, roots: readonly string[]): AgentProject["fingerprints"] {
  const known = new Set<string>(project.fingerprints);
  return roots.filter((r) => !known.has(r)).slice(0, MAX_PER_PROJECT) as AgentProject["fingerprints"];
}
