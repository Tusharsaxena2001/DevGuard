import { normalizeDestination } from "@devguard/policy-engine";
import type { ValidException } from "@devguard/shared";
import type { ApiClient } from "../ports/api-client.js";
import type { ConfigStore } from "../ports/config-store.js";
import { loadEnrollment } from "./load-enrollment.js";

/** `unavailable`: an exception could not be checked (server unreachable or erroring), so none can be used (ADR-004/007). */
export type ExceptionCheck = { readonly state: "valid"; readonly exception: ValidException } | { readonly state: "none" } | { readonly state: "unavailable" };

export interface CheckExceptionDeps {
  readonly store: ConfigStore;
  readonly api: ApiClient;
}

/** Canonical https form of a destination: what is sent to the server instead of the raw remote URL (which may carry credentials). */
export function destinationUrl(destination: { host: string; repoPath: string }): string {
  return `https://${destination.host}/${destination.repoPath}`;
}

/**
 * Push time: does the server hold a valid, unexpired exception for this project and destination? The answer is the
 * server's alone. This function only turns it into the `ValidException` the policy engine expects; the engine then
 * re-checks scope and expiry itself with the local clock. A server that cannot be asked yields no exception.
 */
export async function checkException(deps: CheckExceptionDeps, projectId: string, destinationRaw: string): Promise<ExceptionCheck> {
  const destination = normalizeDestination(destinationRaw);
  if (!destination.ok) return { state: "none" };
  const enrollment = await loadEnrollment(deps.store);
  if (!enrollment.ok) return { state: "none" };

  const reply = await deps.api.validateException(enrollment.value, { projectId, destination: destinationUrl(destination.value) });
  if (!reply.ok) return { state: "unavailable" };
  const r = reply.value;
  if (!r.valid || r.exceptionId === undefined || r.expiresAt === undefined || r.approverId === undefined || r.requesterId === undefined) return { state: "none" };
  return {
    state: "valid",
    exception: {
      id: r.exceptionId,
      projectId,
      destination: destination.value,
      status: "approved",
      expiresAt: r.expiresAt,
      approverId: r.approverId,
      requesterId: r.requesterId,
      // An exception covers the destination only (ADR-007). Whatever the server says here is ignored: waiving secrets
      // or prohibited files would need an explicit feature, not a field in a reply.
      waivedRuleIds: [],
    },
  };
}
