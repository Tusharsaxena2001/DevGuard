import { describe, expect, it } from "vitest";
import { fail, ok } from "../result.js";
import { fakeApi, fakeStore, fixedClock, syntheticSecret } from "../../test/support/fakes.js";
import type { AgentConfig } from "../ports/local-state.js";
import { checkServer } from "./check-server.js";
import { loadEnrollment } from "./load-enrollment.js";

const config: AgentConfig = { serverUrl: "https://devguard.example.test", deviceId: "dev-1" };
const credentials = { deviceId: "dev-1", deviceSecret: syntheticSecret() };
const agent = { nodePath: "n", mainPath: "m", version: "0.3.0" };

describe("loadEnrollment", () => {
  it("returns the server and credentials when both agree", async () => {
    expect(await loadEnrollment(fakeStore({ config: ok(config), credentials: ok(credentials) }))).toEqual({
      ok: true,
      value: { serverUrl: config.serverUrl, deviceId: "dev-1", deviceSecret: credentials.deviceSecret },
    });
  });

  it("is not_enrolled when either file is missing", async () => {
    expect(await loadEnrollment(fakeStore({ config: ok(config) }))).toEqual({ ok: false, reason: "not_enrolled" });
    expect(await loadEnrollment(fakeStore({ credentials: ok(credentials) }))).toEqual({ ok: false, reason: "not_enrolled" });
  });

  it.each([
    ["invalid config", { config: fail("invalid"), credentials: ok(credentials) }],
    ["insecure credentials", { config: ok(config), credentials: fail("insecure_permissions") }],
    ["different device ids", { config: ok(config), credentials: ok({ ...credentials, deviceId: "other" }) }],
  ] as const)("is unusable for %s", async (_name, overrides) => {
    expect(await loadEnrollment(fakeStore(overrides as never))).toEqual({ ok: false, reason: "unusable" });
  });
});

describe("checkServer", () => {
  function run(api: ReturnType<typeof fakeApi>, files: Parameters<typeof fakeStore>[0] = { config: ok(config), credentials: ok(credentials) }) {
    const writes: AgentConfig[] = [];
    const store = { ...fakeStore(files), writeConfig: async (c: AgentConfig) => void writes.push(c) };
    return { writes, result: checkServer({ store, api, clock: fixedClock(), agent }) };
  }

  it("sends a heartbeat with the agent version and remembers the contact time", async () => {
    const api = fakeApi({ heartbeat: ok(undefined) });
    const { result, writes } = run(api);
    expect(await result).toEqual({ state: "reachable" });
    expect(api.calls[0]?.args[1]).toEqual({ agentVersion: "0.3.0" });
    expect(writes).toEqual([{ ...config, lastContactAt: "2026-06-01T12:00:00.000Z" }]);
  });

  it.each(["revoked", "unauthorized", "unreachable"] as const)("reports %s and records no contact", async (reason) => {
    const { result, writes } = run(fakeApi({ heartbeat: fail(reason) }));
    expect(await result).toEqual({ state: "failed", reason });
    expect(writes).toEqual([]);
  });

  it("does not call the server when not enrolled or when local state is unusable", async () => {
    const api = fakeApi({ heartbeat: ok(undefined) });
    expect(await run(api, {}).result).toEqual({ state: "not_enrolled" });
    expect(await run(api, { config: fail("invalid") }).result).toEqual({ state: "unusable_state" });
    expect(api.calls).toEqual([]);
  });

  it("succeeds even if remembering the contact time fails", async () => {
    const store = {
      ...fakeStore({ config: ok(config), credentials: ok(credentials) }),
      writeConfig: async () => {
        throw new Error("read-only disk");
      },
    };
    const api = fakeApi({ heartbeat: ok(undefined) });
    expect(await checkServer({ store, api, clock: fixedClock(), agent })).toEqual({ state: "reachable" });
  });
});
