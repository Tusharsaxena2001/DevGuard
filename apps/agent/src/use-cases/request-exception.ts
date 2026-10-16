import { normalizeDestination } from "@devguard/policy-engine";
import { ExceptionRequestInputSchema, type ExceptionEntry, type ExceptionPage } from "@devguard/shared";
import { AgentError } from "../errors.js";
import type { ApiClient, ApiFailure } from "../ports/api-client.js";
import type { ConfigStore } from "../ports/config-store.js";
import type { GitPort } from "../ports/git.js";
import { destinationUrl } from "./check-exception.js";
import { loadEnrollment } from "./load-enrollment.js";
import { resolveRepo } from "./resolve-repo.js";

export interface ExceptionDeps {
  readonly store: ConfigStore;
  readonly git: GitPort;
  readonly api: ApiClient;
}

export type RequestOutcome =
  | { readonly state: "requested"; readonly entry: ExceptionEntry }
  /** No `--project` and the current repo does not identify exactly one: say which projects it could be. */
  | { readonly state: "needs_project"; readonly candidates: readonly { readonly projectId: string; readonly name: string }[] }
  | { readonly state: "not_enrolled" }
  | { readonly state: "unusable_state" }
  | { readonly state: "failed"; readonly reason: ApiFailure };

export interface RequestInput {
  readonly destination: string;
  readonly reason: string;
  readonly projectId?: string | undefined;
  readonly cwd: string;
}

/** The project the current repository belongs to, if it is exactly one. */
async function projectOfRepo(deps: ExceptionDeps, cwd: string): Promise<{ id?: string; candidates: { projectId: string; name: string }[] }> {
  const root = await deps.git.repoRoot(cwd);
  if (root === undefined) return { candidates: [] };
  const main = await deps.git.mainWorktreeRoot(cwd);
  const resolved = await resolveRepo(deps, { cwd, repoRoots: main === undefined ? [root] : [root, main] });
  if (!resolved.ok || !resolved.value.matched) return { candidates: [] };
  const candidates = resolved.value.projects.map((m) => ({ projectId: m.project.projectId, name: m.project.name }));
  const only = candidates.length === 1 ? candidates[0] : undefined;
  return only === undefined ? { candidates } : { id: only.projectId, candidates };
}

/**
 * `devguard request-exception`: ask an administrator to allow one project to push to one destination. The server
 * checks everything (assignment, destination, reason); the agent only prepares the request. The destination is sent in
 * its canonical https form, never as typed, because a pasted remote URL can carry credentials.
 */
export async function requestException(deps: ExceptionDeps, input: RequestInput): Promise<RequestOutcome> {
  const destination = normalizeDestination(input.destination);
  if (!destination.ok) throw new AgentError("usage_error", "That destination is not a Git remote DevGuard understands. Use the repository URL, for example https://github.com/owner/repo.");
  if (input.reason.trim().length < 10) throw new AgentError("usage_error", "Give a reason of at least 10 characters so the approver can decide.");

  const enrollment = await loadEnrollment(deps.store);
  if (!enrollment.ok) return { state: enrollment.reason === "not_enrolled" ? "not_enrolled" : "unusable_state" };

  let projectId = input.projectId;
  if (projectId === undefined) {
    const found = await projectOfRepo(deps, input.cwd);
    if (found.id === undefined) return { state: "needs_project", candidates: found.candidates };
    projectId = found.id;
  }

  const body = ExceptionRequestInputSchema.safeParse({ projectId, destination: destinationUrl(destination.value), reason: input.reason.trim() });
  if (!body.success) throw new AgentError("usage_error", "The project id or the reason is not valid.");
  const reply = await deps.api.requestException(enrollment.value, body.data);
  return reply.ok ? { state: "requested", entry: reply.value } : { state: "failed", reason: reply.reason };
}

export type StatusOutcome =
  | { readonly state: "list"; readonly page: ExceptionPage }
  | { readonly state: "one"; readonly entry: ExceptionEntry }
  | { readonly state: "not_enrolled" }
  | { readonly state: "unusable_state" }
  | { readonly state: "failed"; readonly reason: ApiFailure };

/** `devguard exception status [id]`: the owner's own requests and what became of them. */
export async function exceptionStatus(deps: Pick<ExceptionDeps, "store" | "api">, id: string | undefined): Promise<StatusOutcome> {
  const enrollment = await loadEnrollment(deps.store);
  if (!enrollment.ok) return { state: enrollment.reason === "not_enrolled" ? "not_enrolled" : "unusable_state" };
  if (id === undefined) {
    const reply = await deps.api.listExceptions(enrollment.value);
    return reply.ok ? { state: "list", page: reply.value } : { state: "failed", reason: reply.reason };
  }
  const reply = await deps.api.getException(enrollment.value, id);
  return reply.ok ? { state: "one", entry: reply.value } : { state: "failed", reason: reply.reason };
}
