import { IsoDateTimeSchema, type NormalizedDestination, type ValidException } from "@devguard/shared";
import { fail, ok, type Result } from "../result.js";

export type ExceptionRejection =
  | "not_approved"
  | "wrong_project"
  | "wrong_destination"
  | "self_approved"
  | "invalid_time"
  | "expired";

export interface ExceptionScope {
  readonly projectId: string;
  /** Already normalized (see `normalizeDestination`). */
  readonly destination: NormalizedDestination;
  readonly now: Date;
}

/**
 * Does this exception authorise a push of `scope.projectId` to `scope.destination` at `scope.now`?
 *
 * Every condition must hold: status `approved`, same project, exactly the same host + repo path, approver differs
 * from requester (invariant 6), and `now` strictly before `expiresAt` (`now === expiresAt` is expired). An
 * unparsable expiry or an invalid `now` rejects: it never validates by accident. Pure, so the API can reuse it.
 */
export function validateException(
  exception: ValidException,
  scope: ExceptionScope,
): Result<ValidException, ExceptionRejection> {
  if (exception.status !== "approved") return fail("not_approved");
  if (exception.projectId !== scope.projectId) return fail("wrong_project");
  if (exception.destination.host !== scope.destination.host || exception.destination.repoPath !== scope.destination.repoPath) {
    return fail("wrong_destination");
  }
  if (exception.approverId === exception.requesterId) return fail("self_approved");

  const now = scope.now.getTime();
  // Strict ISO-8601 with `Z`: lenient `Date.parse` forms would depend on the machine's timezone.
  const expiresAt = IsoDateTimeSchema.safeParse(exception.expiresAt).success ? Date.parse(exception.expiresAt) : NaN;
  if (Number.isNaN(now) || Number.isNaN(expiresAt)) return fail("invalid_time");
  if (now >= expiresAt) return fail("expired");

  return ok(exception);
}
