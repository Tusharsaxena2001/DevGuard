import type { z } from "zod";

/** A failed call, reduced to what the UI can act on. Server messages are generic by design (no stack, no secrets). */
export class ApiRequestError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues: readonly { path: string; code: string }[] = [],
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export type Query = Readonly<Record<string, string | number | boolean | undefined>>;

/**
 * The only place that calls `fetch`. Every success body is parsed with a shared Zod schema, so a server that answers
 * with something unexpected becomes an error, not a half-rendered screen. Cookies ride along (httpOnly session).
 */
export interface ApiClient {
  get<S extends z.ZodType>(path: string, schema: S, query?: Query): Promise<z.output<S>>;
  send<S extends z.ZodType>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, schema: S, body?: unknown): Promise<z.output<S>>;
}

const buildUrl = (path: string, query: Query | undefined): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text === "" ? path : `${path}?${text}`;
};

async function failure(response: Response): Promise<ApiRequestError> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown; issues?: unknown };
    const issues = Array.isArray(body.issues) ? body.issues.flatMap((i: unknown) => (typeof i === "object" && i !== null && "path" in i && "code" in i ? [{ path: String((i as { path: unknown }).path), code: String((i as { code: unknown }).code) }] : [])) : [];
    return new ApiRequestError(response.status, typeof body.code === "string" ? body.code : "error", typeof body.message === "string" ? body.message : "The request failed.", issues);
  } catch {
    return new ApiRequestError(response.status, "error", "The request failed.");
  }
}

export function createApiClient(fetchFn: typeof fetch = (input, init) => fetch(input, init)): ApiClient {
  async function run<S extends z.ZodType>(method: string, url: string, schema: S, body?: unknown): Promise<z.output<S>> {
    let response: Response;
    try {
      response = await fetchFn(url, {
        method,
        credentials: "same-origin",
        headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiRequestError(0, "unreachable", "Could not reach the DevGuard server.");
    }
    if (!response.ok) throw await failure(response);
    if (response.status === 204) return schema.parse(undefined);
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new ApiRequestError(response.status, "invalid_response", "The server's reply was not what the dashboard expects.");
    return parsed.data;
  }
  return {
    get: (path, schema, query) => run("GET", buildUrl(path, query), schema),
    send: (method, path, schema, body) => run(method, path, schema, body),
  };
}
