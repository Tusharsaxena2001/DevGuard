import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/app/App.js";
import { createQueryClient } from "../src/app/query-client.js";
import { ApiProvider } from "../src/shared/api/api-context.js";
import { createApiClient } from "../src/shared/lib/api-client.js";

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

export interface Reply {
  readonly status?: number;
  readonly body?: unknown;
}

type Handler = Reply | ((call: Call) => Reply | Promise<Reply>);

/**
 * A fake network: handlers are keyed `"GET /v1/events"`. Anything not handled is a 404 and is recorded, so a test can
 * assert both what the page asked for and what it did not.
 */
export function fakeNetwork(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const call: Call = { method, path: url.pathname, query: url.searchParams, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const handler = handlers[`${method} ${url.pathname}`];
    const reply = handler === undefined ? { status: 404, body: { code: "not_found", message: "The requested resource was not found." } } : typeof handler === "function" ? await handler(call) : handler;
    const status = reply.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchFn, calls, calledWith: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path) };
}

export function renderApp(route: string, network: ReturnType<typeof fakeNetwork>) {
  const queries = createQueryClient({ retry: 0 });
  return render(
    <QueryClientProvider client={queries}>
      <ApiProvider client={createApiClient(network.fetchFn)}>
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>
      </ApiProvider>
    </QueryClientProvider>,
  );
}
