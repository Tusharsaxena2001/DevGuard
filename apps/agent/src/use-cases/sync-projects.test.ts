import { describe, expect, it } from "vitest";
import type { AgentProject } from "@devguard/shared";
import { fail, ok } from "../result.js";
import { cachedPolicy, fakeApi, fakeStore, fixedClock, project, syntheticSecret } from "../../test/support/fakes.js";
import type { ConfigStore } from "../ports/config-store.js";
import type { AgentConfig, CachedPolicy } from "../ports/local-state.js";
import { syncProjects } from "./sync-projects.js";

const config: AgentConfig = { serverUrl: "https://devguard.example.test", deviceId: "dev-1", projectsEtag: '"old"', syncedProjectIds: ["proj-1"] };
const credentials = { deviceId: "dev-1", deviceSecret: syntheticSecret() };
const NOW = "2026-06-01T12:00:00.000Z";

/** A store that behaves like the real one: writes are visible to later reads. */
function memoryStore(initial: { config?: AgentConfig; policies?: Record<string, CachedPolicy> } = {}) {
  let cfg: AgentConfig | undefined = "config" in initial ? initial.config : config;
  const policies = new Map(Object.entries(initial.policies ?? {}));
  const deleted: string[] = [];
  const store: ConfigStore = {
    ...fakeStore(),
    readConfig: async () => ok(cfg),
    readCredentials: async () => ok(credentials),
    writeConfig: async (c) => void (cfg = c),
    listPolicyIds: async () => ok([...policies.keys()].sort()),
    readPolicy: async (id) => ok(policies.get(id)),
    writePolicy: async (p) => void policies.set(p.project.projectId, p),
    deletePolicy: async (id) => {
      deleted.push(id);
      policies.delete(id);
    },
  };
  return { store, policies, deleted, config: () => cfg };
}

const p = (id: string, over: Partial<AgentProject> = {}): AgentProject => ({ ...project(id), ...over });
const reply = (projects: AgentProject[], etag: string | undefined = '"new"') => ok({ notModified: false as const, sync: { projects, syncedAt: NOW }, etag });
const server = (id: string, fetchedAt = "2026-06-01T09:00:00.000Z"): CachedPolicy => ({ ...cachedPolicy(id, fetchedAt), source: "server" });

describe("syncProjects", () => {
  it("caches every project as server-sourced with the fetch time, then remembers the ETag and contact time", async () => {
    const m = memoryStore();
    const api = fakeApi({ getProjects: reply([p("proj-1"), p("proj-2")]) });
    expect(await syncProjects({ store: m.store, api, clock: fixedClock(NOW) })).toEqual({ state: "updated", projects: 2, removed: 0 });
    expect(m.policies.get("proj-1")).toMatchObject({ fetchedAt: NOW, source: "server" });
    expect(m.policies.size).toBe(2);
    expect(m.config()).toMatchObject({ projectsEtag: '"new"', lastContactAt: NOW });
  });

  it("removes server-sourced projects that are no longer assigned, but never a locally supplied policy", async () => {
    const local: CachedPolicy = { ...cachedPolicy("proj-local"), source: "local" };
    const legacy = cachedPolicy("proj-legacy"); // no `source`: treated as local
    const m = memoryStore({ policies: { "proj-gone": server("proj-gone"), "proj-local": local, "proj-legacy": legacy } });
    const api = fakeApi({ getProjects: reply([p("proj-1")]) });
    expect(await syncProjects({ store: m.store, api, clock: fixedClock(NOW) })).toEqual({ state: "updated", projects: 1, removed: 1 });
    expect(m.deleted).toEqual(["proj-gone"]);
    expect([...m.policies.keys()].sort()).toEqual(["proj-1", "proj-legacy", "proj-local"]);
  });

  it("lets the server replace a locally supplied policy for the same project", async () => {
    const m = memoryStore({ policies: { "proj-1": { ...cachedPolicy("proj-1"), source: "local" } } });
    await syncProjects({ store: m.store, api: fakeApi({ getProjects: reply([p("proj-1")]) }), clock: fixedClock(NOW) });
    expect(m.policies.get("proj-1")?.source).toBe("server");
  });

  it("sends the stored ETag and, on 304, only refreshes the fetch times", async () => {
    const m = memoryStore({ policies: { "proj-1": server("proj-1") } });
    const api = fakeApi({ getProjects: ok({ notModified: true }) });
    expect(await syncProjects({ store: m.store, api, clock: fixedClock(NOW) })).toEqual({ state: "unchanged", projects: 1 });
    expect(api.calls[0]?.args[1]).toBe('"old"');
    expect(m.policies.get("proj-1")?.fetchedAt).toBe(NOW);
    expect(m.config()).toMatchObject({ projectsEtag: '"old"', lastContactAt: NOW });
  });

  it("does not send the ETag when a cached policy was deleted since the last sync, so the 304 cannot leave a gap", async () => {
    const m = memoryStore({ policies: {} });
    const api = fakeApi({ getProjects: reply([p("proj-1")]) });
    await syncProjects({ store: m.store, api, clock: fixedClock(NOW) });
    expect(api.calls[0]?.args[1]).toBeUndefined();
    expect(m.policies.has("proj-1")).toBe(true);
  });

  it("does not send the ETag when an unrecorded server policy appeared in the cache", async () => {
    const m = memoryStore({ policies: { "proj-1": server("proj-1"), "proj-2": server("proj-2") } });
    const api = fakeApi({ getProjects: reply([p("proj-1")]) });
    await syncProjects({ store: m.store, api, clock: fixedClock(NOW) });
    expect(api.calls[0]?.args[1]).toBeUndefined();
  });

  it("records which projects the ETag belongs to", async () => {
    const m = memoryStore();
    await syncProjects({ store: m.store, api: fakeApi({ getProjects: reply([p("proj-1"), p("proj-2")]) }), clock: fixedClock(NOW) });
    expect(m.config()?.syncedProjectIds).toEqual(["proj-1", "proj-2"]);
  });

  it("does not send the ETag when a cached policy cannot be read, so the cache is rebuilt", async () => {
    const m = memoryStore({ policies: { "proj-1": server("proj-1") } });
    const store: ConfigStore = { ...m.store, readPolicy: async () => fail("invalid") };
    const api = fakeApi({ getProjects: reply([p("proj-1")]) });
    await syncProjects({ store, api, clock: fixedClock(NOW) });
    expect(api.calls[0]?.args[1]).toBeUndefined();
    expect(m.policies.get("proj-1")?.fetchedAt).toBe(NOW);
  });

  it("keeps the cache exactly as it was when the server cannot be reached", async () => {
    const before = server("proj-1");
    const m = memoryStore({ policies: { "proj-1": before } });
    for (const reason of ["unreachable", "revoked", "unauthorized", "server_error"] as const) {
      expect(await syncProjects({ store: m.store, api: fakeApi({ getProjects: fail(reason) }), clock: fixedClock(NOW) })).toEqual({ state: "failed", reason });
    }
    expect(m.policies.get("proj-1")).toEqual(before);
    expect(m.deleted).toEqual([]);
    expect(m.config()).toEqual(config);
  });

  it.each([
    ["an unsafe project id", [p("../etc")]],
    ["a duplicate project id", [p("proj-1"), p("proj-1")]],
  ])("refuses a reply with %s without caching any of it", async (_name, projects) => {
    const m = memoryStore({ policies: { "proj-9": server("proj-9") } });
    expect(await syncProjects({ store: m.store, api: fakeApi({ getProjects: reply(projects) }), clock: fixedClock(NOW) })).toEqual({ state: "failed", reason: "invalid_response" });
    expect([...m.policies.keys()]).toEqual(["proj-9"]);
  });

  it("an empty assignment list clears the server-sourced cache", async () => {
    const m = memoryStore({ policies: { "proj-1": server("proj-1") } });
    expect(await syncProjects({ store: m.store, api: fakeApi({ getProjects: reply([]) }), clock: fixedClock(NOW) })).toEqual({ state: "updated", projects: 0, removed: 1 });
  });

  it("does not call the server when not enrolled or when local state is unusable", async () => {
    const api = fakeApi({ getProjects: reply([]) });
    const notEnrolled: ConfigStore = { ...fakeStore(), readCredentials: async () => ok(undefined), readConfig: async () => ok(undefined) };
    expect(await syncProjects({ store: notEnrolled, api, clock: fixedClock(NOW) })).toEqual({ state: "not_enrolled" });
    const broken: ConfigStore = { ...fakeStore(), readConfig: async () => fail("invalid"), readCredentials: async () => ok(credentials) };
    expect(await syncProjects({ store: broken, api, clock: fixedClock(NOW) })).toEqual({ state: "unusable_state" });
    expect(api.calls).toEqual([]);
  });

  it("authenticates with the enrolled device and never puts the secret into the outcome", async () => {
    const m = memoryStore();
    const api = fakeApi({ getProjects: reply([p("proj-1")]) });
    const outcome = await syncProjects({ store: m.store, api, clock: fixedClock(NOW) });
    expect(api.calls[0]?.args[0]).toEqual({ serverUrl: config.serverUrl, deviceId: "dev-1", deviceSecret: credentials.deviceSecret });
    expect(JSON.stringify(outcome)).not.toContain(credentials.deviceSecret);
  });
});
