/** Stable machine-readable error codes shared across agent, API and dashboard. */
export const ErrorCode = {
  Unauthenticated: "unauthenticated",
  Forbidden: "forbidden",
  NotFound: "not_found",
  ValidationFailed: "validation_failed",
  Conflict: "conflict",
  RateLimited: "rate_limited",
  DeviceRevoked: "device_revoked",
  EnrollmentTokenInvalid: "enrollment_token_invalid",
  ExceptionNotValid: "exception_not_valid",
  SelfApprovalForbidden: "self_approval_forbidden",
  PolicyUnavailable: "policy_unavailable",
  Internal: "internal_error",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
