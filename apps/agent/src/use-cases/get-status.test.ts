import { describe, expect, it } from "vitest";
import { fail, ok } from "../result.js";
import { cachedPolicy, fakeStore, syntheticSecret } from "../../test/support/fakes.js";
import { getStatus } from "./get-status.js";

const config = ok({ serverUrl: "https://devguard.example.com", deviceId: "dev-1" });
const credentials = ok({ deviceId: "dev-1", deviceSecret: syntheticSecret() });

describe("getStatus", () => {
  it("a fresh device is healthy but not enrolled", async () => {
    expect(await getStatus(fakeStore())).toEqual({
      location: "/fake/home",
      enrolled: false,
      healthy: true,
      config: "missing",
      credentials: "missing",
      repos: "missing",
      policyCache: "ok",
      registeredRepoCount: 0,
      policies: [],
    });
  });

  it("an enrolled device reports server and device id", async () => {
    const report = await getStatus(fakeStore({ config, credentials }));
    expect(report).toMatchObject({ enrolled: true, healthy: true, serverUrl: "https://devguard.example.com", deviceId: "dev-1" });
  });

  it("config without credentials (or the reverse) is not enrolled", async () => {
    expect((await getStatus(fakeStore({ config }))).enrolled).toBe(false);
    expect((await getStatus(fakeStore({ credentials }))).enrolled).toBe(false);
  });

  it.each(["invalid", "insecure_permissions", "unreadable"] as const)("a %s credentials file is unhealthy and not enrolled", async (reason) => {
    const report = await getStatus(fakeStore({ config, credentials: fail(reason) }));
    expect(report).toMatchObject({ enrolled: false, healthy: false, credentials: reason });
  });

  it.each(["config", "repos"] as const)("an invalid %s file is unhealthy", async (file) => {
    expect((await getStatus(fakeStore({ [file]: fail("invalid") }))).healthy).toBe(false);
  });

  it("a config and credentials that name different devices are inconsistent: not enrolled, unhealthy", async () => {
    const other = ok({ deviceId: "dev-2", deviceSecret: syntheticSecret() });
    expect(await getStatus(fakeStore({ config, credentials: other }))).toMatchObject({
      enrolled: false,
      healthy: false,
      config: "invalid",
      credentials: "invalid",
    });
  });

  it.each(["unreadable", "insecure_permissions", "invalid"] as const)("a policy cache that cannot be listed (%s) is unhealthy, not 'none'", async (reason) => {
    const report = await getStatus(fakeStore({ policyList: fail(reason) }));
    expect(report).toMatchObject({ policyCache: reason, healthy: false, policies: [] });
  });

  it("counts registered repos", async () => {
    const repos = ok({ repos: [{ repoPath: "/a", projectId: "p", registeredAt: "2026-06-01T12:00:00.000Z" }, { repoPath: "/b", projectId: "p", registeredAt: "2026-06-01T12:00:00.000Z" }] });
    expect(await getStatus(fakeStore({ repos }))).toMatchObject({ repos: "ok", registeredRepoCount: 2 });
  });

  it("lists cached policies with their fetch time, and flags a bad one as unhealthy", async () => {
    const report = await getStatus(
      fakeStore({}, { "proj-a": ok(cachedPolicy("proj-a", "2026-06-02T00:00:00.000Z")), "proj-b": fail("invalid") }),
    );
    expect(report.policies).toEqual([
      { projectId: "proj-a", state: "ok", fetchedAt: "2026-06-02T00:00:00.000Z", source: "local" },
      { projectId: "proj-b", state: "invalid" },
    ]);
    expect(report.healthy).toBe(false);
  });

  it("never carries the device secret", async () => {
    const report = await getStatus(fakeStore({ config, credentials }));
    expect(JSON.stringify(report)).not.toContain(syntheticSecret());
  });
});

describe("getStatus policy freshness (ADR-004)", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");
  const policies = {
    "srv-fresh": ok({ ...cachedPolicy("srv-fresh", "2026-06-01T11:58:00.000Z"), source: "server" as const }),
    "srv-old": ok({ ...cachedPolicy("srv-old", "2026-06-01T10:00:00.000Z"), source: "server" as const }),
    "local-old": ok({ ...cachedPolicy("local-old", "2016-01-01T00:00:00.000Z"), source: "local" as const }),
  };

  it("classifies server policies by age and never ages local ones", async () => {
    const report = await getStatus(fakeStore({}, policies), { now, maxStaleMinutes: 60 });
    const byId = Object.fromEntries(report.policies.map((p) => [p.projectId, p]));
    expect(byId["srv-fresh"]).toMatchObject({ source: "server", freshness: "fresh" });
    expect(byId["srv-old"]).toMatchObject({ source: "server", freshness: "expired" });
    expect(byId["local-old"]).toMatchObject({ source: "local" });
    expect(byId["local-old"]?.freshness).toBeUndefined();
  });

  it("omits freshness when the caller gives no clock", async () => {
    const report = await getStatus(fakeStore({}, policies));
    expect(report.policies.every((p) => p.freshness === undefined)).toBe(true);
  });
});
