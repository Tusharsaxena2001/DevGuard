import type {
  AgentProjectSync,
  EnrollRequest,
  EnrollResponse,
  EventBatchResult,
  ExceptionEntry,
  ExceptionPage,
  ExceptionRequestInput,
  ExceptionValidationResult,
  HeartbeatRequest,
  ReportFingerprintRequest,
  SecurityEventBatch,
} from "@devguard/shared";
import type { Result } from "../result.js";

/**
 * Why a server call failed, in terms the agent can act on. No kind carries server text, so nothing a server
 * (or someone impersonating it) sends can reach the terminal through an error.
 */
export type ApiFailure =
  | "unreachable" // network error, DNS failure, timeout
  | "unauthorized" // the device credential was not accepted
  | "revoked" // an administrator revoked this device
  | "token_invalid" // enrollment token unknown, used or expired
  | "rate_limited"
  | "server_error" // 5xx after retries
  | "rejected" // any other 4xx: the request is wrong for this server
  | "invalid_response" // reply did not match the shared contract (or was too large)
  | "invalid_server_url"; // not https (or localhost http), or carries credentials

export type ApiResult<T> = Result<T, ApiFailure>;

/** Where to send an authenticated request, and as whom. `deviceSecret` is a secret: never log or print it. */
export interface DeviceAuth {
  readonly serverUrl: string;
  readonly deviceId: string;
  readonly deviceSecret: string;
}

/** Result of asking for the assigned projects: unchanged since `etag`, or the new set. */
export type ProjectsReply =
  | { readonly notModified: true }
  | { readonly notModified: false; readonly sync: AgentProjectSync; readonly etag: string | undefined };

/** Typed calls to the DevGuard API (`/v1`). Later modules add their calls here. Never throws. */
export interface ApiClient {
  /** Exchange a one-time enrollment token for device credentials. Not retried: the token is single use. */
  enroll(serverUrl: string, request: EnrollRequest): Promise<ApiResult<EnrollResponse>>;
  /** Tell the server this device is alive. Idempotent, so transient failures are retried. */
  heartbeat(auth: DeviceAuth, request: HeartbeatRequest): Promise<ApiResult<undefined>>;
  /** Every project assigned to this device's owner (policy, destinations, canonical repos, fingerprints). `etag` makes it conditional. */
  getProjects(auth: DeviceAuth, etag?: string): Promise<ApiResult<ProjectsReply>>;
  /** Tell the server a repo matched by remote has this root commit (ADR-008). Safe to repeat. */
  reportFingerprint(auth: DeviceAuth, request: ReportFingerprintRequest): Promise<ApiResult<undefined>>;
  /** Deliver security events. The server de-duplicates by idempotency key, so retrying is safe. */
  sendEvents(auth: DeviceAuth, batch: SecurityEventBatch): Promise<ApiResult<EventBatchResult>>;
  /** Ask for permission to push a project to a destination. Not retried: a repeat would be a second request. */
  requestException(auth: DeviceAuth, request: ExceptionRequestInput): Promise<ApiResult<ExceptionEntry>>;
  /** The device owner's own requests, newest first. */
  listExceptions(auth: DeviceAuth): Promise<ApiResult<ExceptionPage>>;
  getException(auth: DeviceAuth, id: string): Promise<ApiResult<ExceptionEntry>>;
  /** May the owner push this project to this destination now? The server decides from its own records and clock. */
  validateException(auth: DeviceAuth, request: { projectId: string; destination: string }): Promise<ApiResult<ExceptionValidationResult>>;
}
