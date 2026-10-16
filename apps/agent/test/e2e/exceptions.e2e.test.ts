import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsConfigStore } from "../../src/adapters/fs-store/fs-config-store.js";
import { StubApi } from "./stub-api.js";
import { UNAPPROVED, secret, World } from "./world.js";

let w: World;
let api: StubApi;
const deviceId = "11111111-1111-4111-8111-111111111111";
const deviceSecret = ["dgs", "synthetic", "e2e"].join("_");

const granted = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  valid: true,
  exceptionId: "exc-9",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  approverId: "admin-1",
  requesterId: "user-1",
  waivedRuleIds: [],
  ...over,
});

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

describe("exceptions through the real hook", () => {
  it("a blocked push explains how to ask, with a ready command for this project and destination", () => {
    const bare = w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "x\n" });
    const push = w.git(["push", "fork", "HEAD:refs/heads/main"]);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("devguard request-exception --project proj-1 --destination https://github.com/personal/fork --reason");
    expect(w.refsOf(bare)).toBe("");
    // The hook asked the server, with the canonical destination (not the raw remote URL).
    expect(api.validations).toEqual([{ projectId: "proj-1", destination: "https://github.com/personal/fork" }]);
  });

  it("the developer requests an exception, an approval arrives, and the retried push goes through as outcome exception", () => {
    const bare = w.addRemote("fork", UNAPPROVED);
    const sha = w.commit({ "a.txt": "x\n" });
    expect(w.git(["push", "fork", "HEAD:refs/heads/main"]).status).not.toBe(0);

    const asked = w.devguard(["request-exception", "--destination", "git@github.com:personal/fork.git", "--reason", "Handing the code over to the customer"]);
    expect(asked.status).toBe(0);
    expect(asked.stdout).toContain("Request id: 11111111-1111-4111-8111-111111111111");

    api.grantException(granted());
    const retry = w.git(["push", "fork", "HEAD:refs/heads/main"]);
    expect(retry.status).toBe(0);
    expect(retry.stderr).toContain("allowed by approved exception exc-9");
    expect(w.refsOf(bare)).toContain(`refs/heads/main ${sha}`);
    expect(w.events().at(-1)).toMatchObject({ outcome: "exception", exceptionId: "exc-9", projectId: "proj-1" });
    expect(api.delivered.at(-1)).toMatchObject({ outcome: "exception", exceptionId: "exc-9" });
  });

  it("an exception does not waive a secret: the push is still blocked", () => {
    const bare = w.addRemote("fork", UNAPPROVED);
    w.commit({ "src/config.ts": `export const token = "${secret()}";\n` });
    api.grantException(granted());
    const push = w.git(["push", "fork", "HEAD:refs/heads/main"]);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("DevGuard blocked this push.");
    expect(w.refsOf(bare)).toBe("");
  });

  it.each([
    ["expired", { expiresAt: new Date(Date.now() - 60_000).toISOString() }],
    ["self-approved", { approverId: "user-1" }],
  ])("a server answer that is %s is refused by the policy engine as well", (_name, over) => {
    const bare = w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "x\n" });
    api.grantException(granted(over));
    expect(w.git(["push", "fork", "HEAD:refs/heads/main"]).status).not.toBe(0);
    expect(w.refsOf(bare)).toBe("");
  });

  it("offline, an approved exception cannot be used: the push is blocked and says why (ADR-004)", () => {
    const bare = w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "x\n" });
    api.grantException(granted());
    api.up = false;
    const push = w.git(["push", "fork", "HEAD:refs/heads/main"]);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("could not be checked because the DevGuard server is unreachable");
    expect(w.refsOf(bare)).toBe("");
  });

  it("an approved destination never asks the server", () => {
    w.commit({ "a.txt": "x\n" });
    expect(w.git(["push", "origin", "HEAD:refs/heads/main"]).status).toBe(0);
    expect(api.validations).toEqual([]);
  });
});
