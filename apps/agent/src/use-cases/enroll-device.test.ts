import { describe, expect, it } from "vitest";
import { AgentError } from "../errors.js";
import { fail, ok } from "../result.js";
import { fakeApi, fakeGit, fakeStore, fixedClock, memoryHookFiles, syntheticSecret } from "../../test/support/fakes.js";
import type { ConfigStore } from "../ports/config-store.js";
import type { AgentConfig, DeviceCredentials, InstallState } from "../ports/local-state.js";
import { enrollDevice, type EnrollDeps } from "./enroll-device.js";

const SERVER = "https://devguard.example.test";
const TOKEN = ["dgt", "synthetic", "Token123"].join("_");
const agent = { nodePath: "/usr/bin/node", mainPath: "/opt/devguard/main.js", version: "0.3.0" };

interface Writes {
  config?: AgentConfig;
  credentials?: DeviceCredentials;
  order: string[];
}

function recordingStore(existing?: AgentConfig, failOn?: "credentials" | "config"): ConfigStore & { writes: Writes } {
  const writes: Writes = { order: [] };
  let install: InstallState = { repos: [] };
  const base = fakeStore({ config: ok(existing) }, {}, "/state");
  let savedConfig: AgentConfig | undefined = existing;
  let savedCredentials: DeviceCredentials | undefined;
  return {
    ...base,
    writes,
    readConfig: async () => ok(savedConfig),
    readCredentials: async () => ok(savedCredentials),
    readInstall: async () => ok(install),
    writeInstall: async (next) => void (install = next),
    writeCredentials: async (c) => {
      if (failOn === "credentials") throw new AgentError("store_write_failed", "disk full");
      writes.credentials = c;
      savedCredentials = c;
      writes.order.push("credentials");
    },
    writeConfig: async (c) => {
      if (failOn === "config") throw new AgentError("store_write_failed", "disk full");
      writes.config = c;
      savedConfig = c;
      writes.order.push("config");
    },
  };
}

function setup(over: { api?: ReturnType<typeof fakeApi>; store?: ConfigStore & { writes: Writes }; git?: ReturnType<typeof fakeGit> } = {}) {
  const store = over.store ?? recordingStore();
  const api = over.api ?? fakeApi({ enroll: ok({ deviceId: "dev-1", deviceSecret: syntheticSecret() }) });
  const git = over.git ?? fakeGit();
  const files = memoryHookFiles();
  const deps: EnrollDeps = { store, git, files, clock: fixedClock(), agent, api, device: { name: "alice-laptop", os: "linux 6.8" }, userHome: "/home/dev" };
  return { deps, store, api, git, files };
}

describe("enrollDevice", () => {
  it("sends the token and device facts, saves credentials then config, and installs the global hook", async () => {
    const { deps, store, api, git } = setup();
    const outcome = await enrollDevice(deps, { serverUrl: SERVER, token: ` ${TOKEN} ` });
    expect(outcome).toMatchObject({ ok: true, deviceId: "dev-1", serverUrl: SERVER, replacedPrevious: false, hook: { ok: true } });
    expect(api.calls[0]).toEqual({ method: "enroll", args: [SERVER, { token: TOKEN, deviceName: "alice-laptop", os: "linux 6.8", agentVersion: "0.3.0" }] });
    expect(store.writes.credentials).toEqual({ deviceId: "dev-1", deviceSecret: syntheticSecret() });
    expect(store.writes.config).toEqual({ serverUrl: SERVER, deviceId: "dev-1", lastContactAt: "2026-06-01T12:00:00.000Z" });
    expect(store.writes.order).toEqual(["credentials", "config"]);
    expect(git.globalConfig.get("core.hooksPath")).toBeDefined();
  });

  it("normalises a trailing slash on the server address", async () => {
    const { deps, store } = setup();
    await enrollDevice(deps, { serverUrl: `${SERVER}//`, token: TOKEN });
    expect(store.writes.config?.serverUrl).toBe(SERVER);
  });

  it.each([
    ["token invalid", "token_invalid"],
    ["unreachable", "unreachable"],
    ["rate limited", "rate_limited"],
  ] as const)("changes nothing locally when the server says %s", async (_name, reason) => {
    const { deps, store, git } = setup({ api: fakeApi({ enroll: fail(reason) }) });
    expect(await enrollDevice(deps, { serverUrl: SERVER, token: TOKEN })).toEqual({ ok: false, reason });
    expect(store.writes.order).toEqual([]);
    expect(git.globalConfig.size).toBe(0);
  });

  it.each([["http://example.com"], ["https://user:pw@example.com"], ["ftp://example.com"], ["nope"]])("refuses server %j before contacting it", async (serverUrl) => {
    const { deps, api } = setup();
    await expect(enrollDevice(deps, { serverUrl, token: TOKEN })).rejects.toMatchObject({ code: "usage_error" });
    expect(api.calls).toEqual([]);
  });

  it("allows plain http to localhost for development", async () => {
    const { deps } = setup();
    expect((await enrollDevice(deps, { serverUrl: "http://localhost:3000", token: TOKEN })).ok).toBe(true);
  });

  it.each([[""], ["   "], ["x".repeat(300)]])("refuses a malformed token %j without echoing it or contacting the server", async (token) => {
    const { deps, api } = setup();
    const error = await enrollDevice(deps, { serverUrl: SERVER, token }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).message).not.toContain("xxxx");
    expect(api.calls).toEqual([]);
  });

  it("reports a replaced previous enrollment", async () => {
    const store = recordingStore({ serverUrl: SERVER, deviceId: "old" });
    const { deps } = setup({ store });
    expect(await enrollDevice(deps, { serverUrl: SERVER, token: TOKEN })).toMatchObject({ ok: true, replacedPrevious: true });
  });

  it("explains how to recover if the credentials cannot be saved, without printing the secret", async () => {
    const { deps } = setup({ store: recordingStore(undefined, "credentials") });
    const error = (await enrollDevice(deps, { serverUrl: SERVER, token: TOKEN }).catch((e: unknown) => e)) as AgentError;
    expect(error.code).toBe("store_write_failed");
    expect(error.message).toContain("dev-1");
    expect(error.message).toContain("revoke");
    expect(error.message).not.toContain(syntheticSecret());
  });

  it("still enrols when the hook cannot be installed, and says so", async () => {
    const git = fakeGit();
    git.globalConfigSet = async () => {
      throw new Error("git broke");
    };
    const { deps, store } = setup({ git });
    const outcome = await enrollDevice(deps, { serverUrl: SERVER, token: TOKEN });
    expect(outcome).toMatchObject({ ok: true, hook: { ok: false } });
    expect(store.writes.order).toEqual(["credentials", "config"]);
  });

  it("syncs the assigned projects right after enrolling, using the new credentials", async () => {
    const api = fakeApi({
      enroll: ok({ deviceId: "dev-1", deviceSecret: syntheticSecret() }),
      getProjects: ok({ notModified: false, sync: { projects: [], syncedAt: "2026-06-01T12:00:00.000Z" }, etag: undefined }),
    });
    const { deps } = setup({ api });
    const outcome = await enrollDevice(deps, { serverUrl: SERVER, token: TOKEN });
    expect(outcome).toMatchObject({ ok: true, sync: { state: "updated", projects: 0 } });
    expect(api.calls.map((c) => c.method)).toEqual(["enroll", "getProjects"]);
  });

  it("a failed first sync does not undo the enrollment", async () => {
    const { deps, store } = setup();
    const outcome = await enrollDevice(deps, { serverUrl: SERVER, token: TOKEN });
    expect(outcome).toMatchObject({ ok: true, sync: { state: "failed" } });
    expect(store.writes.order).toEqual(["credentials", "config"]);
  });

  it("never puts the token or secret into the outcome", async () => {
    const { deps } = setup();
    const outcome = await enrollDevice(deps, { serverUrl: SERVER, token: TOKEN });
    expect(JSON.stringify(outcome)).not.toContain(TOKEN);
    expect(JSON.stringify(outcome)).not.toContain(syntheticSecret());
  });
});
