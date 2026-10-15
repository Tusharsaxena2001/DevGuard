import { describe, expect, it } from "vitest";
import type { ConfigStore } from "../ports/config-store.js";
import { fail, ok } from "../result.js";
import { fakeGit, fakeStore, fixedClock, memoryHookFiles } from "../../test/support/fakes.js";
import type { InstallState } from "../ports/local-state.js";
import { getHookStatus } from "./get-hook-status.js";
import { installGlobal, installRepo } from "./install-hooks.js";

const STATE = "/home/dev/.config/devguard";
const HOOKS = `${STATE}/hooks`;
const agent = { nodePath: "/usr/bin/node", mainPath: "/opt/devguard/main.js", version: "0.0.0" };

function world(git = fakeGit(), files = memoryHookFiles()) {
  let install: InstallState = { repos: [] };
  const store: ConfigStore = { ...fakeStore({}, {}, STATE), readInstall: async () => ok(install), writeInstall: async (next: InstallState) => void (install = next) };
  return { store, git, files, clock: fixedClock(), agent };
}

describe("getHookStatus", () => {
  it("nothing installed: healthy and quiet", async () => {
    const w = world();
    expect(await getHookStatus(w, "/repo")).toEqual({
      global: "not_installed",
      previousHooksPath: null,
      repos: [{ repoPath: "/repo", perRepoHook: false, originalChained: false }],
      issues: [],
    });
  });

  it("a healthy global install", async () => {
    const w = world();
    await installGlobal(w, undefined);
    expect(await getHookStatus(w, "/repo")).toMatchObject({ global: "installed", issues: [] });
  });

  it("reports the user's previous hooksPath", async () => {
    const w = world(fakeGit({ globalConfig: { "core.hooksPath": "/opt/team" } }));
    await installGlobal(w, undefined);
    expect((await getHookStatus(w, "/repo")).previousHooksPath).toBe("/opt/team");
  });

  it("detects drift when core.hooksPath was changed after install", async () => {
    const w = world();
    await installGlobal(w, undefined);
    w.git.globalConfig.set("core.hooksPath", "/elsewhere");
    const status = await getHookStatus(w, "/repo");
    expect(status.global).toBe("drifted");
    expect(status.issues.join(" ")).toContain("devguard install --global");
  });

  it("detects drift when the wrapper script is gone or no longer a DevGuard script", async () => {
    const w = world();
    await installGlobal(w, undefined);
    w.files.files.delete(`${HOOKS}/pre-push`);
    expect((await getHookStatus(w, "/repo")).global).toBe("drifted");
    w.files.files.set(`${HOOKS}/pre-push`, "#!/bin/sh\n");
    expect((await getHookStatus(w, "/repo")).global).toBe("drifted");
  });

  it("detects a repo-level core.hooksPath override of the current repo and says the hook does not run there", async () => {
    const w = world(fakeGit({ localConfig: { "/repo\0core.hooksPath": ".husky" } }));
    await installGlobal(w, undefined);
    const status = await getHookStatus(w, "/repo");
    expect(status.repos).toEqual([{ repoPath: "/repo", perRepoHook: false, originalChained: false, overriddenBy: ".husky" }]);
    expect(status.issues.join(" ")).toMatch(/\/repo sets core.hooksPath=\.husky.*does not run/);
  });

  it("lists per-repo installs and registered repos too", async () => {
    const w = world(fakeGit({ repoRoot: "/repo" }));
    w.store.readRepos = async () => ok({ repos: [{ repoPath: "/registered", projectId: "p", registeredAt: "2026-06-01T12:00:00.000Z" }] });
    await installRepo(w, "/repo");
    const status = await getHookStatus(w, "/repo");
    expect(status.repos.map((r) => r.repoPath)).toEqual(["/registered", "/repo"]);
    expect(status.repos.find((r) => r.repoPath === "/repo")).toMatchObject({ perRepoHook: true });
  });

  it("reports an unreadable install record instead of claiming 'not installed'", async () => {
    const w = world();
    w.store.readInstall = async () => fail("invalid");
    expect((await getHookStatus(w, "/repo")).issues.join(" ")).toContain("install record");
  });

  it("outside a repository there is just the global state", async () => {
    const w = world(fakeGit({ repoRoot: undefined }));
    expect((await getHookStatus(w, "/tmp")).repos).toEqual([]);
  });
});
