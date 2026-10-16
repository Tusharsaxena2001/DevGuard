import { z } from "zod";
import {
  AgentProjectSyncSchema,
  EnrollResponseSchema,
  EventBatchResultSchema,
  ExceptionEntrySchema,
  ExceptionPageSchema,
  ExceptionValidationResultSchema,
  formatDeviceCredential,
  type EnrollRequest,
  type EnrollResponse,
  type EventBatchResult,
  type ExceptionEntry,
  type ExceptionPage,
  type ExceptionRequestInput,
  type ExceptionValidationResult,
  type HeartbeatRequest,
  type ReportFingerprintRequest,
  type SecurityEventBatch,
} from "@devguard/shared";
import type { ApiClient, ApiFailure, ApiResult, DeviceAuth, ProjectsReply } from "../ports/api-client.js";
import { isAcceptableServerUrl } from "../ports/local-state.js";
import { fail, ok } from "../result.js";

const MAX_BODY_CHARS = 1_048_576;
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([502, 503, 504]);
const ErrorBodySchema = z.object({ code: z.string() }).loose();

export interface HttpApiClientOptions {
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  /** Total attempts for retryable calls (1 = no retry). */
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
}

interface Call<T> {
  readonly serverUrl: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: unknown;
  readonly bearer?: string;
  /** Sent as `If-None-Match`; a 304 then yields `notModified`. */
  readonly etag?: string;
  readonly notModified?: T;
  /** Parses the success body (and may read headers); `undefined` means the call expects no body (204). */
  readonly parse: ((json: unknown, headers: Headers) => T | undefined) | undefined;
  readonly retry: boolean;
}

function failureForStatus(status: number, code: string | undefined): ApiFailure {
  if (status === 401) return code === "device_revoked" ? "revoked" : "unauthorized";
  if (status === 400 && code === "enrollment_token_invalid") return "token_invalid";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "rejected";
}

/**
 * HTTP client over `fetch` (Node >= 22). Safety properties:
 *  - the server URL must be https (http only for loopback) and is re-checked on every call;
 *  - redirects are refused (`redirect: "error"`), so the device secret is never forwarded to another host;
 *  - every call has a timeout; only idempotent calls are retried, with bounded exponential backoff;
 *  - success bodies are parsed with the shared Zod contracts and size-capped; failures reduce to an `ApiFailure`
 *    kind, never server-provided text;
 *  - request bodies, the bearer value and responses are never logged (this module has no logger).
 */
export function createHttpApiClient(options: HttpApiClientOptions = {}): ApiClient {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 250;

  async function attempt<T>(call: Call<T>): Promise<{ result: ApiResult<T | undefined>; retryable: boolean }> {
    try {
      const response = await doFetch(`${call.serverUrl.replace(/\/+$/, "")}${call.path}`, {
        method: call.method,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: "application/json",
          ...(call.body === undefined ? {} : { "content-type": "application/json" }),
          ...(call.bearer === undefined ? {} : { authorization: `Bearer ${call.bearer}` }),
          ...(call.etag === undefined ? {} : { "if-none-match": call.etag }),
        },
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      });
      // Refuse an oversized body up front when the server declares its size; the check after reading covers chunked replies.
      if (Number(response.headers.get("content-length") ?? 0) > MAX_BODY_CHARS) return { result: fail("invalid_response"), retryable: false };
      const text = await response.text();
      if (text.length > MAX_BODY_CHARS) return { result: fail("invalid_response"), retryable: false };
      if (response.status === 304 && call.etag !== undefined && call.notModified !== undefined) return { result: ok(call.notModified), retryable: false };
      if (response.ok) {
        if (call.parse === undefined) return { result: ok(undefined), retryable: false };
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          return { result: fail("invalid_response"), retryable: false };
        }
        const value = call.parse(json, response.headers);
        return value === undefined ? { result: fail("invalid_response"), retryable: false } : { result: ok(value), retryable: false };
      }
      let code: string | undefined;
      try {
        const parsed = ErrorBodySchema.safeParse(JSON.parse(text));
        code = parsed.success ? parsed.data.code : undefined;
      } catch {
        code = undefined;
      }
      return { result: fail(failureForStatus(response.status, code)), retryable: RETRYABLE_STATUS.has(response.status) };
    } catch {
      // Network failure, DNS, timeout, refused redirect, aborted body: all "could not get a usable answer".
      return { result: fail("unreachable"), retryable: true };
    }
  }

  async function send<T>(call: Call<T>): Promise<ApiResult<T | undefined>> {
    if (!isAcceptableServerUrl(call.serverUrl)) return fail("invalid_server_url");
    const attempts = call.retry ? maxAttempts : 1;
    let last: ApiResult<T | undefined> = fail("unreachable");
    for (let n = 1; n <= attempts; n++) {
      const { result, retryable } = await attempt(call);
      last = result;
      if (result.ok || !retryable || n === attempts) return result;
      await sleep(baseDelayMs * 2 ** (n - 1));
    }
    return last;
  }

  return {
    async enroll(serverUrl: string, request: EnrollRequest): Promise<ApiResult<EnrollResponse>> {
      const result = await send<EnrollResponse>({
        serverUrl,
        method: "POST",
        path: "/v1/devices/enroll",
        body: request,
        parse: (json) => {
          const parsed = EnrollResponseSchema.safeParse(json);
          return parsed.success ? parsed.data : undefined;
        },
        retry: false,
      });
      return result.ok && result.value !== undefined ? ok(result.value) : result.ok ? fail("invalid_response") : result;
    },

    async heartbeat(auth: DeviceAuth, request: HeartbeatRequest): Promise<ApiResult<undefined>> {
      const result = await send<undefined>({
        serverUrl: auth.serverUrl,
        method: "POST",
        path: "/v1/devices/heartbeat",
        body: request,
        bearer: formatDeviceCredential(auth.deviceId, auth.deviceSecret),
        parse: undefined,
        retry: true,
      });
      return result.ok ? ok(undefined) : result;
    },

    async getProjects(auth: DeviceAuth, etag?: string): Promise<ApiResult<ProjectsReply>> {
      const notModified: ProjectsReply = { notModified: true };
      const result = await send<ProjectsReply>({
        serverUrl: auth.serverUrl,
        method: "GET",
        path: "/v1/agent/projects",
        bearer: formatDeviceCredential(auth.deviceId, auth.deviceSecret),
        ...(etag === undefined ? {} : { etag }),
        notModified,
        parse: (json, headers) => {
          const parsed = AgentProjectSyncSchema.safeParse(json);
          return parsed.success ? { notModified: false, sync: parsed.data, etag: headers.get("etag") ?? undefined } : undefined;
        },
        retry: true,
      });
      return result.ok && result.value !== undefined ? ok(result.value) : result.ok ? fail("invalid_response") : result;
    },

    async reportFingerprint(auth: DeviceAuth, request: ReportFingerprintRequest): Promise<ApiResult<undefined>> {
      const result = await send<undefined>({
        serverUrl: auth.serverUrl,
        method: "POST",
        path: "/v1/agent/repo-fingerprints",
        body: request,
        bearer: formatDeviceCredential(auth.deviceId, auth.deviceSecret),
        parse: undefined,
        retry: true,
      });
      return result.ok ? ok(undefined) : result;
    },

    async sendEvents(auth: DeviceAuth, batch: SecurityEventBatch): Promise<ApiResult<EventBatchResult>> {
      const result = await send<EventBatchResult>({
        serverUrl: auth.serverUrl,
        method: "POST",
        path: "/v1/agent/events",
        body: batch,
        bearer: formatDeviceCredential(auth.deviceId, auth.deviceSecret),
        parse: (json) => {
          const parsed = EventBatchResultSchema.safeParse(json);
          return parsed.success ? parsed.data : undefined;
        },
        retry: true,
      });
      return result.ok && result.value !== undefined ? ok(result.value) : result.ok ? fail("invalid_response") : result;
    },

    async requestException(auth: DeviceAuth, request: ExceptionRequestInput): Promise<ApiResult<ExceptionEntry>> {
      return call<ExceptionEntry>(auth, "POST", "/v1/agent/exceptions", (json) => parseWith(ExceptionEntrySchema, json), false, request);
    },

    async listExceptions(auth: DeviceAuth): Promise<ApiResult<ExceptionPage>> {
      return call<ExceptionPage>(auth, "GET", "/v1/agent/exceptions?pageSize=50", (json) => parseWith(ExceptionPageSchema, json), true);
    },

    async getException(auth: DeviceAuth, id: string): Promise<ApiResult<ExceptionEntry>> {
      return call<ExceptionEntry>(auth, "GET", `/v1/agent/exceptions/${encodeURIComponent(id)}`, (json) => parseWith(ExceptionEntrySchema, json), true);
    },

    async validateException(auth: DeviceAuth, request: { projectId: string; destination: string }): Promise<ApiResult<ExceptionValidationResult>> {
      return call<ExceptionValidationResult>(auth, "POST", "/v1/agent/exceptions/validate", (json) => parseWith(ExceptionValidationResultSchema, json), true, request);
    },
  };

  /** One authenticated JSON call with a Zod-validated reply. */
  async function call<T>(auth: DeviceAuth, method: "GET" | "POST", path: string, parse: (json: unknown) => T | undefined, retry: boolean, body?: unknown): Promise<ApiResult<T>> {
    const result = await send<T>({
      serverUrl: auth.serverUrl,
      method,
      path,
      ...(body === undefined ? {} : { body }),
      bearer: formatDeviceCredential(auth.deviceId, auth.deviceSecret),
      parse,
      retry,
    });
    return result.ok && result.value !== undefined ? ok(result.value) : result.ok ? fail("invalid_response") : result;
  }
}

function parseWith<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, json: unknown): T | undefined {
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}
