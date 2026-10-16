import { ErrorCode } from "@devguard/shared";

export interface ErrorIssue {
  readonly path: string;
  readonly code: string;
}

/** Typed error with a stable code. Mapped to HTTP only at the edge (see `httpStatusFor`). */
export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly issues: readonly ErrorIssue[];

  public constructor(code: ErrorCode, message: string, issues: readonly ErrorIssue[] = []) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.issues = issues;
  }
}

export function httpStatusFor(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.Unauthenticated:
    case ErrorCode.DeviceRevoked: // a revoked device is unauthenticated; the code lets the agent tell the cases apart
      return 401;
    case ErrorCode.Forbidden:
    case ErrorCode.SelfApprovalForbidden:
      return 403;
    case ErrorCode.NotFound:
      return 404;
    case ErrorCode.Conflict:
      return 409;
    case ErrorCode.RateLimited:
      return 429;
    case ErrorCode.ValidationFailed:
    case ErrorCode.EnrollmentTokenInvalid:
    case ErrorCode.ExceptionNotValid:
      return 400;
    case ErrorCode.PolicyUnavailable:
      return 503;
    case ErrorCode.Internal:
      return 500;
  }
}

/** Fixed, non-revealing messages for errors that did not come from our own code. */
export const GENERIC_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  [ErrorCode.Unauthenticated]: "Authentication is required.",
  [ErrorCode.Forbidden]: "You do not have permission to do this.",
  [ErrorCode.NotFound]: "The requested resource was not found.",
  [ErrorCode.ValidationFailed]: "The request is invalid.",
  [ErrorCode.Conflict]: "The request conflicts with the current state.",
  [ErrorCode.RateLimited]: "Too many requests. Try again later.",
  [ErrorCode.DeviceRevoked]: "This device has been revoked.",
  [ErrorCode.EnrollmentTokenInvalid]: "The enrollment token is invalid or expired.",
  [ErrorCode.ExceptionNotValid]: "The exception is not valid.",
  [ErrorCode.SelfApprovalForbidden]: "You cannot approve your own request.",
  [ErrorCode.PolicyUnavailable]: "Policy is temporarily unavailable.",
  [ErrorCode.Internal]: "An internal error occurred.",
};
