import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsConfigStore } from "../../src/adapters/fs-store/fs-config-store.js";
import { StubApi } from "./stub-api.js";
import { UNAPPROVED, secret, World } from "./world.js";

let w: World;
let api: StubApi;
const deviceId = "11111111-1111-4111-8111-111111111111";
const deviceSecret = ["dgs", "synthetic", "e2e"].join("_");

beforeEach(async () => {
  w = new World();
  api = new StubApi();
  await api.start();
  await w.protect();
  const store = createFsConfigStore(w.state);
  await store.writeConfig({ serverUrl: `http://127.0.0.1:${api.port}`, deviceId });
  await store.writeCredentials({ deviceId, deviceSecret });
  expect(w.devguard(["install", "--global"]).status).toBe(0);
});
afterEach(async () => {
  await api.stop();
  w.cleanup();
});

const spoolFiles = (): string[] => {
  try {
    return readdirSync(join(w.state, "spool")).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
};

describe("event delivery through the real hook", () => {
  it("delivers a blocked push's event with the device credential, the same reference the developer saw, and no secret value", async () => {
    const bare = w.addRemote("fork", UNAPPROVED);
    w.commit({ "src/config.ts": `export const token = "${secret()}";\n` });
    const before = w.refsOf(bare);
    const push = w.git(["push", "fork", "HEAD:refs/heads/main"]);
    expect(push.status).not.toBe(0);
    expect(w.refsOf(bare)).toBe(before);

    expect(api.received).toHaveLength(1);
    expect(api.received[0]?.authorization).toBe(`Bearer ${deviceId}.${deviceSecret}`);
    const [delivered] = api.delivered;
    expect(delivered).toMatchObject({ outcome: "blocked", projectId: "proj-1", operation: "branch_create", destination: { host: "github.com", repoPath: "personal/fork" } });
    const reference = /Reference: (\S+)/.exec(push.stderr)?.[1];
    expect(delivered?.["correlationId"]).toBe(reference);
    // Rule, kind and path are reported; the secret value never leaves the machine (events, spool or request body).
    expect(JSON.stringify(delivered)).toContain("github_token");
    expect(api.received[0]?.raw).not.toContain(secret());
    expect(spoolFiles()).toEqual([]);
  });

  it("an outage changes nothing about the decision; the event waits in the spool and is delivered with the next push", async () => {
    api.up = false;
    const bare = w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "x\n" });
    const blocked = w.git(["push", "fork", "HEAD:refs/heads/main"]);
    expect(blocked.stderr).toContain("DevGuard blocked this push.");
    expect(w.refsOf(bare)).toBe("");
    expect(spoolFiles()).toHaveLength(1);
    expect(api.delivered).toEqual([]);

    api.up = true;
    const sha = w.commit({ "b.txt": "y\n" });
    const allowed = w.git(["push", "origin", "HEAD:refs/heads/main"]);
    expect(allowed.status).toBe(0);
    expect(w.refsOf(`${w.remotes}/acme/portal.git`)).toContain(`refs/heads/main ${sha}`);
    expect(api.delivered.map((e) => e["outcome"]).sort()).toEqual(["allowed", "blocked"]);
    expect(spoolFiles()).toEqual([]);
  });

  it("devguard status shows how many events are still waiting while the server is down", async () => {
    api.up = false;
    w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "x\n" });
    w.git(["push", "fork", "HEAD:refs/heads/main"]);
    expect(w.devguard(["status"]).stdout).toContain("Pending events: 1");
  });

  it("an unenrolled device keeps recording locally and queues nothing it cannot send", async () => {
    const store = createFsConfigStore(w.state);
    await store.writeCredentials({ deviceId: "22222222-2222-4222-8222-222222222222", deviceSecret });
    w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "x\n" });
    const push = w.git(["push", "fork", "HEAD:refs/heads/main"]);
    expect(push.stderr).toContain("DevGuard blocked this push.");
    expect(w.events().at(-1)).toMatchObject({ outcome: "blocked" });
    expect(api.delivered).toEqual([]);
  });
});
