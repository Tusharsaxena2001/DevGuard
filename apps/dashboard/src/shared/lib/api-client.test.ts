import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiRequestError, createApiClient } from "./api-client.js";

const respond = (status: number, body?: unknown): typeof fetch =>
  (async () => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;

describe("api client", () => {
  it("returns the parsed body and sends the query string without empty values", async () => {
    let seen = "";
    const client = createApiClient((async (input: RequestInfo | URL) => ((seen = String(input)), new Response(JSON.stringify({ n: 1 })))) as typeof fetch);
    expect(await client.get("/v1/x", z.object({ n: z.number() }), { page: 2, empty: "", missing: undefined, flag: true })).toEqual({ n: 1 });
    expect(seen).toBe("/v1/x?page=2&flag=true");
  });

  it("turns a reply that does not match the shared schema into invalid_response, not a half-rendered screen", async () => {
    const client = createApiClient(respond(200, { n: "one" }));
    await expect(client.get("/v1/x", z.object({ n: z.number() }))).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("carries status, code and field issues from an error body", async () => {
    const client = createApiClient(respond(400, { code: "validation_failed", message: "The request is invalid.", issues: [{ path: "url", code: "empty" }] }));
    const error = await client.send("POST", "/v1/x", z.unknown(), {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 400, code: "validation_failed", issues: [{ path: "url", code: "empty" }] });
  });

  it("handles an error body that is not JSON", async () => {
    const client = createApiClient((async () => new Response("<html>", { status: 502 })) as typeof fetch);
    await expect(client.get("/v1/x", z.unknown())).rejects.toMatchObject({ status: 502, code: "error" });
  });

  it("reports an unreachable server as such", async () => {
    const client = createApiClient((async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch);
    await expect(client.get("/v1/x", z.unknown())).rejects.toMatchObject({ status: 0, code: "unreachable" });
  });

  it("accepts a 204 for an undefined schema and sends JSON bodies with the session cookie", async () => {
    let init: RequestInit | undefined;
    const client = createApiClient((async (_i: RequestInfo | URL, i?: RequestInit) => ((init = i), new Response(null, { status: 204 }))) as typeof fetch);
    await expect(client.send("POST", "/v1/x", z.undefined(), { a: 1 })).resolves.toBeUndefined();
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", body: '{"a":1}' });
  });
});
