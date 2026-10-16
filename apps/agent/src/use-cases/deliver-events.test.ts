import { describe, expect, it } from "vitest";
import type { SecurityEventInput } from "@devguard/shared";
import { fail, ok } from "../result.js";
import { fakeApi, fakeStore, fixedClock, memorySpool, syntheticSecret } from "../../test/support/fakes.js";
import type { ConfigStore } from "../ports/config-store.js";
import type { AgentConfig } from "../ports/local-state.js";
import { deliverEvents } from "./deliver-events.js";

const config: AgentConfig = { serverUrl: "https://devguard.example.test", deviceId: "dev-1" };
const credentials = { deviceId: "dev-1", deviceSecret: syntheticSecret() };
const event = (n: number): SecurityEventInput => ({
  idempotencyKey: `key-${String(n).padStart(6, "0")}`,
  correlationId: `corr-${String(n).padStart(6, "0")}`,
  occurredAt: "2026-06-01T12:00:00.000Z",
  projectId: null,
  destination: null,
  operation: "push",
  refs: [],
  outcome: "blocked",
  ruleIds: ["destination_not_approved"],
  findings: [],
  mode: "enforce",
  wouldBlock: true,
  policyVersion: 1,
  agentVersion: "0.1.0",
});
const enrolled = (): ConfigStore => ({ ...fakeStore({ config: ok(config), credentials: ok(credentials) }), writeConfig: async () => undefined });
const answerAll = (status: "accepted" | "duplicate" | "rejected" = "accepted") => (batch: { events: SecurityEventInput[] }) =>
  ok({ results: batch.events.map((e) => ({ idempotencyKey: e.idempotencyKey, status })) });

describe("deliverEvents", () => {
  it("sends the spooled events with the device credential and removes them once the server has answered", async () => {
    const spool = memorySpool([event(1), event(2)]);
    const api = fakeApi({ sendEvents: answerAll() });
    expect(await deliverEvents({ store: enrolled(), spool, api, clock: fixedClock() })).toEqual({ state: "delivered", sent: 2, refused: 0, remaining: 0 });
    expect(spool.items.size).toBe(0);
    expect(api.calls[0]?.args[0]).toEqual({ serverUrl: config.serverUrl, deviceId: "dev-1", deviceSecret: credentials.deviceSecret });
    expect((api.calls[0]?.args[1] as { events: unknown[] }).events).toHaveLength(2);
  });

  it("a duplicate answer is final: the event leaves the spool and nothing is lost", async () => {
    const spool = memorySpool([event(1)]);
    const outcome = await deliverEvents({ store: enrolled(), spool, api: fakeApi({ sendEvents: answerAll("duplicate") }), clock: fixedClock() });
    expect(spool.items.size).toBe(0);
    expect(outcome).toMatchObject({ state: "delivered", sent: 1, refused: 0 });
    expect((await spool.stats()).dropped).toBe(0);
  });

  it("a rejected answer is final but honest: the event is discarded, counted as lost and reported as refused, not delivered", async () => {
    const spool = memorySpool([event(1), event(2)]);
    const api = fakeApi({ sendEvents: (batch) => ok({ results: batch.events.map((e, i) => ({ idempotencyKey: e.idempotencyKey, status: i === 0 ? ("rejected" as const) : ("accepted" as const) })) }) });
    const outcome = await deliverEvents({ store: enrolled(), spool, api, clock: fixedClock() });
    expect(outcome).toEqual({ state: "delivered", sent: 1, refused: 1, remaining: 0 });
    expect(spool.items.size).toBe(0);
    expect((await spool.stats()).dropped).toBe(1);
  });

  it("one event the server refuses outright cannot stall the ones behind it: the batch is retried event by event", async () => {
    const spool = memorySpool([event(1), event(2), event(3)]);
    const api = fakeApi({
      sendEvents: (batch) =>
        batch.events.some((e) => e.idempotencyKey === "key-000002")
          ? fail("rejected")
          : ok({ results: batch.events.map((e) => ({ idempotencyKey: e.idempotencyKey, status: "accepted" as const })) }),
    });
    const outcome = await deliverEvents({ store: enrolled(), spool, api, clock: fixedClock() });
    expect(outcome).toEqual({ state: "delivered", sent: 2, refused: 1, remaining: 0 });
    expect(spool.items.size).toBe(0);
    expect((await spool.stats()).dropped).toBe(1);
  });

  it("stops isolating when the server becomes unreachable and keeps the rest queued", async () => {
    const spool = memorySpool([event(1), event(2), event(3)]);
    let calls = 0;
    const api = fakeApi({ sendEvents: () => (++calls === 1 ? fail("rejected") : calls === 2 ? ok({ results: [{ idempotencyKey: "key-000001", status: "accepted" as const }] }) : fail("unreachable")) });
    const outcome = await deliverEvents({ store: enrolled(), spool, api, clock: fixedClock() });
    expect(outcome).toMatchObject({ state: "failed", reason: "rejected", sent: 1 });
    expect([...spool.items.keys()]).toEqual(["key-000002", "key-000003"]);
  });

  it("a single event the server refuses on its own is discarded and counted", async () => {
    const spool = memorySpool([event(1)]);
    const outcome = await deliverEvents({ store: enrolled(), spool, api: fakeApi({ sendEvents: fail("rejected") }), clock: fixedClock() });
    expect(outcome).toEqual({ state: "delivered", sent: 0, refused: 1, remaining: 0 });
    expect((await spool.stats()).dropped).toBe(1);
  });

  it("sends at most the configured number of requests (the hook uses one)", async () => {
    const spool = memorySpool(Array.from({ length: 120 }, (_, i) => event(i + 1)));
    const api = fakeApi({ sendEvents: answerAll() });
    const outcome = await deliverEvents({ store: enrolled(), spool, api, clock: fixedClock(), maxBatches: 1 });
    expect(api.calls).toHaveLength(1);
    expect(outcome).toEqual({ state: "delivered", sent: 50, refused: 0, remaining: 70 });
  });

  it.each(["unreachable", "server_error", "rate_limited", "unauthorized", "revoked"] as const)("keeps every event when delivery fails (%s)", async (reason) => {
    const spool = memorySpool([event(1), event(2)]);
    const outcome = await deliverEvents({ store: enrolled(), spool, api: fakeApi({ sendEvents: fail(reason) }), clock: fixedClock() });
    expect(outcome).toEqual({ state: "failed", reason, sent: 0, refused: 0, remaining: 2 });
    expect(spool.items.size).toBe(2);
  });

  it("keeps an event the server did not answer for", async () => {
    const spool = memorySpool([event(1), event(2)]);
    // The server only ever answers for event 1; event 2 must stay queued, and the loop must not spin on it.
    const api = fakeApi({ sendEvents: () => ok({ results: [{ idempotencyKey: "key-000001", status: "accepted" as const }] }) });
    const outcome = await deliverEvents({ store: enrolled(), spool, api, clock: fixedClock() });
    expect([...spool.items.keys()]).toEqual(["key-000002"]);
    expect(outcome).toMatchObject({ state: "failed", reason: "invalid_response", remaining: 1 });
  });

  it("stops (instead of looping) when the answer covers none of what was sent", async () => {
    const spool = memorySpool([event(1)]);
    const api = fakeApi({ sendEvents: ok({ results: [{ idempotencyKey: "something-else", status: "accepted" }] }) });
    expect(await deliverEvents({ store: enrolled(), spool, api, clock: fixedClock() })).toMatchObject({ state: "failed", reason: "invalid_response" });
    expect(api.calls).toHaveLength(1);
    expect(spool.items.size).toBe(1);
  });

  it("does nothing, and makes no request, when the spool is empty", async () => {
    const api = fakeApi({ sendEvents: answerAll() });
    expect(await deliverEvents({ store: enrolled(), spool: memorySpool(), api, clock: fixedClock() })).toEqual({ state: "nothing_pending" });
    expect(api.calls).toEqual([]);
  });

  it("does not call the server when not enrolled or when local state is unusable", async () => {
    const api = fakeApi({ sendEvents: answerAll() });
    const spool = memorySpool([event(1)]);
    expect(await deliverEvents({ store: fakeStore(), spool, api, clock: fixedClock() })).toEqual({ state: "not_enrolled" });
    const broken: ConfigStore = { ...fakeStore(), readConfig: async () => fail("invalid"), readCredentials: async () => ok(credentials) };
    expect(await deliverEvents({ store: broken, spool, api, clock: fixedClock() })).toEqual({ state: "unusable_state" });
    expect(api.calls).toEqual([]);
    expect(spool.items.size).toBe(1);
  });

  it("sends at most 50 events per request and at most five requests per run, leaving the rest for next time", async () => {
    const spool = memorySpool(Array.from({ length: 400 }, (_, i) => event(i + 1)));
    const api = fakeApi({ sendEvents: answerAll() });
    const outcome = await deliverEvents({ store: enrolled(), spool, api, clock: fixedClock() });
    expect(api.calls).toHaveLength(5);
    expect(api.calls.every((c) => (c.args[1] as { events: unknown[] }).events.length <= 50)).toBe(true);
    expect(outcome).toEqual({ state: "delivered", sent: 250, refused: 0, remaining: 150 });
  });

  it("keeps a request under the byte budget by sending fewer events", async () => {
    const big = (n: number): SecurityEventInput => ({ ...event(n), findings: Array.from({ length: 500 }, (_, i) => ({ ruleId: "github_token", kind: "secret" as const, path: `${"d".repeat(900)}/file-${i}.ts`, line: i + 1 })) });
    const spool = memorySpool([big(1), big(2), big(3), big(4)]);
    const api = fakeApi({ sendEvents: answerAll() });
    await deliverEvents({ store: enrolled(), spool, api, clock: fixedClock() });
    const first = api.calls[0]?.args[1] as { events: unknown[] };
    expect(JSON.stringify(first).length).toBeLessThan(950_000);
    expect(first.events.length).toBeLessThan(4);
    expect(spool.items.size).toBe(0);
  });

  it("never puts the device secret in its outcome", async () => {
    const outcome = await deliverEvents({ store: enrolled(), spool: memorySpool([event(1)]), api: fakeApi({ sendEvents: answerAll() }), clock: fixedClock() });
    expect(JSON.stringify(outcome)).not.toContain(credentials.deviceSecret);
  });
});
