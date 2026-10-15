import { describe, expect, it } from "vitest";
import { AgentError } from "../errors.js";
import { fail, ok } from "../result.js";
import { fakeGit, fakeStore, fixedClock, memoryHookFiles } from "../../test/support/fakes.js";
import type { ConfigStore } from "../ports/config-store.js";
import type { InstallState } from "../ports/local-state.js";
import { isManaged, PASSTHROUGH_HOOKS } from "./hook-wrapper.js";
import { installGlobal, installRepo, type HookDeps } from "./install-hooks.js";
import { uninstallGlobal, uninstallRepo } from "./uninstall-hooks.js";

const STATE = "/home/dev/.config/devguard";
const HOOKS = `${STATE}/hooks`;
const agent = { nodePath: "/usr/bin/node", mainPath: "/opt/devguard/main.js", version: "0.0.0" };

/** A store whose install record persists across calls, so install/uninstall can be exercised end to end. */
function persistentStore(initial: InstallState = { repos: [] }): ConfigStore & { current(): InstallState } {
  let state = initial;
  return { ...fakeStore({}, {}, STATE), readInstall: async () => ok(state), writeInstall: async (next) => void (state = next), current: () => state };
}

function setup(over: { git?: ReturnType<typeof fakeGit>; files?: ReturnType<typeof memoryHookFiles>; store?: ConfigStore } = {}): HookDeps & { git: ReturnType<typeof fakeGit>; files: ReturnType<typeof memoryHookFiles> } {
  return { store: over.store ?? persistentStore(), git: over.git ?? fakeGit(), files: over.files ?? memoryHookFiles(), clock: fixedClock(), agent };
}

describe("installGlobal", () => {
  it("writes the wrapper and a pass-through for every other hook, then points core.hooksPath at the directory", async () => {
    const deps = setup();
    const result = await installGlobal(deps, "/home/dev");
    expect(result).toEqual({ status: "installed", hooksDir: HOOKS, previousHooksPath: null });
    expect(deps.git.globalConfig.get("core.hooksPath")).toBe(HOOKS);
    expect(isManaged(deps.files.files.get(`${HOOKS}/pre-push`))).toBe(true);
    for (const name of PASSTHROUGH_HOOKS) expect(isManaged(deps.files.files.get(`${HOOKS}/${name}`))).toBe(true);
    expect(deps.files.files.size).toBe(1 + PASSTHROUGH_HOOKS.length);
  });

  it("records the install (hooks dir, previous value, time) before changing Git's configuration", async () => {
    const order: string[] = [];
    const store = persistentStore();
    const git = fakeGit();
    const baseSet = git.globalConfigSet;
    git.globalConfigSet = async (k, v) => (order.push(`config:${JSON.stringify(store.current().global !== undefined)}`), baseSet(k, v));
    await installGlobal(setup({ store, git }), undefined);
    expect(order).toEqual(["config:true"]);
    expect(store.current().global).toEqual({ hooksDir: HOOKS, previousHooksPath: null, installedAt: "2026-06-01T12:00:00.000Z" });
  });

  it("keeps the user's own global core.hooksPath and chains to it", async () => {
    const deps = setup({ git: fakeGit({ globalConfig: { "core.hooksPath": "/opt/team-hooks" } }) });
    const result = await installGlobal(deps, "/home/dev");
    expect(result.previousHooksPath).toBe("/opt/team-hooks");
    expect(deps.files.files.get(`${HOOKS}/pre-push`)).toContain("'/opt/team-hooks/pre-push'");
    expect(deps.files.files.get(`${HOOKS}/pre-commit`)).toContain("'/opt/team-hooks/pre-commit'");
  });

  it("expands ~ in the previous hooksPath the way Git does, but records the original text", async () => {
    const store = persistentStore();
    const deps = setup({ store, git: fakeGit({ globalConfig: { "core.hooksPath": "~/my-hooks" } }) });
    await installGlobal(deps, "/home/dev");
    expect(deps.files.files.get(`${HOOKS}/pre-push`)).toContain("'/home/dev/my-hooks/pre-push'");
    expect(store.current().global?.previousHooksPath).toBe("~/my-hooks");
  });

  it("is a no-op the second time", async () => {
    const deps = setup();
    await installGlobal(deps, "/home/dev");
    const before = new Map(deps.files.files);
    const again = await installGlobal(deps, "/home/dev");
    expect(again.status).toBe("already_installed");
    expect(deps.files.files).toEqual(before);
  });

  it("never records its own directory as the 'previous' hooksPath, even after a second install", async () => {
    const store = persistentStore();
    const deps = setup({ store, git: fakeGit({ globalConfig: { "core.hooksPath": "/opt/team-hooks" } }) });
    await installGlobal(deps, "/home/dev");
    await installGlobal(deps, "/home/dev");
    expect(store.current().global?.previousHooksPath).toBe("/opt/team-hooks");
  });

  it("reports an update (and rewrites scripts) when the agent location changed", async () => {
    const deps = setup();
    await installGlobal(deps, "/home/dev");
    const moved = { ...deps, agent: { ...agent, mainPath: "/new/place/main.js" } };
    expect((await installGlobal(moved, "/home/dev")).status).toBe("updated");
    expect(deps.files.files.get(`${HOOKS}/pre-push`)).toContain("/new/place/main.js");
  });

  it("treats a user-changed hooksPath after install as the new 'previous' value", async () => {
    const store = persistentStore();
    const deps = setup({ store });
    await installGlobal(deps, undefined);
    deps.git.globalConfig.set("core.hooksPath", "/someone/elses");
    const result = await installGlobal(deps, undefined);
    expect(result).toMatchObject({ status: "updated", previousHooksPath: "/someone/elses" });
    expect(deps.git.globalConfig.get("core.hooksPath")).toBe(HOOKS);
  });

  it.each([
    ["an empty value", "", /set but empty/],
    ["a ~user path", "~alice/hooks", /~user form/],
  ])("refuses a previous global core.hooksPath that is %s, before writing anything", async (_name, value, message) => {
    const deps = setup({ git: fakeGit({ globalConfig: { "core.hooksPath": value } }) });
    await expect(installGlobal(deps, "/home/dev")).rejects.toThrow(message);
    expect(deps.files.files.size).toBe(0);
    expect(deps.git.globalConfig.get("core.hooksPath")).toBe(value);
  });

  it("expands a bare ~ in the previous hooksPath to the home directory", async () => {
    const deps = setup({ git: fakeGit({ globalConfig: { "core.hooksPath": "~" } }) });
    await installGlobal(deps, "/home/dev");
    expect(deps.files.files.get(`${HOOKS}/pre-push`)).toContain("'/home/dev/pre-push'");
  });

  it("refuses ~ in the previous hooksPath when there is no home directory", async () => {
    const deps = setup({ git: fakeGit({ globalConfig: { "core.hooksPath": "~/h" } }) });
    await expect(installGlobal(deps, undefined)).rejects.toThrow(/without a home directory/);
  });

  it("refuses to proceed on an unusable install record, changing nothing", async () => {
    const deps = setup({ store: { ...fakeStore({}, {}, STATE), readInstall: async () => fail("insecure_permissions") } });
    await expect(installGlobal(deps, undefined)).rejects.toMatchObject({ code: "config_invalid" });
    expect(deps.files.files.size).toBe(0);
    expect(deps.git.globalConfig.size).toBe(0);
  });
});

describe("uninstallGlobal", () => {
  it("restores an unset hooksPath exactly and removes every script it wrote", async () => {
    const store = persistentStore();
    const deps = setup({ store });
    await installGlobal(deps, undefined);
    const result = await uninstallGlobal(deps);
    expect(result).toEqual({ status: "removed", warnings: [] });
    expect(deps.git.globalConfig.has("core.hooksPath")).toBe(false);
    expect(deps.files.files.size).toBe(0);
    expect(store.current()).toEqual({ repos: [] });
  });

  it("restores the user's previous hooksPath value exactly (including ~)", async () => {
    const deps = setup({ git: fakeGit({ globalConfig: { "core.hooksPath": "~/my-hooks" } }) });
    await installGlobal(deps, "/home/dev");
    await uninstallGlobal(deps);
    expect(deps.git.globalConfig.get("core.hooksPath")).toBe("~/my-hooks");
  });

  it("leaves a hooksPath the user changed since install, and says so", async () => {
    const deps = setup();
    await installGlobal(deps, undefined);
    deps.git.globalConfig.set("core.hooksPath", "/someone/elses");
    const result = await uninstallGlobal(deps);
    expect(deps.git.globalConfig.get("core.hooksPath")).toBe("/someone/elses");
    expect(result.warnings.join(" ")).toContain("/someone/elses");
  });

  it("never deletes a script without the DevGuard marker", async () => {
    const deps = setup();
    await installGlobal(deps, undefined);
    deps.files.files.set(`${HOOKS}/pre-commit`, "#!/bin/sh\necho mine\n");
    const result = await uninstallGlobal(deps);
    expect(deps.files.files.get(`${HOOKS}/pre-commit`)).toBe("#!/bin/sh\necho mine\n");
    expect(result.warnings.join(" ")).toContain("pre-commit");
    expect(deps.files.files.has(`${HOOKS}/pre-push`)).toBe(false);
  });

  it("does nothing when not installed", async () => {
    const deps = setup({ git: fakeGit({ globalConfig: { "core.hooksPath": "/opt/other" } }) });
    expect(await uninstallGlobal(deps)).toEqual({ status: "not_installed", warnings: [] });
    expect(deps.git.globalConfig.get("core.hooksPath")).toBe("/opt/other");
  });

  it("keeps per-repo install records", async () => {
    const store = persistentStore({ repos: [{ repoPath: "/r", hooksDir: "/r/.git/hooks", installedAt: "2026-06-01T12:00:00.000Z" }] });
    const deps = setup({ store });
    await installGlobal(deps, undefined);
    await uninstallGlobal(deps);
    expect(store.current().repos).toHaveLength(1);
  });
});

describe("installRepo / uninstallRepo", () => {
  const HOOK = "/repo/.git/hooks/pre-push";
  const ORIG = `${HOOK}.devguard-orig`;

  it("installs the wrapper into the repo's own hooks directory and records it", async () => {
    const store = persistentStore();
    const deps = setup({ store });
    const result = await installRepo(deps, "/repo");
    expect(result).toEqual({ status: "installed", repoPath: "/repo", hookPath: HOOK, chainedOriginal: false });
    expect(isManaged(deps.files.files.get(HOOK))).toBe(true);
    expect(store.current().repos).toEqual([{ repoPath: "/repo", hooksDir: "/repo/.git/hooks", installedAt: "2026-06-01T12:00:00.000Z" }]);
  });

  it("moves an existing hook aside, chains to it, and restores it byte for byte on uninstall", async () => {
    const original = "#!/bin/sh\necho 'my own hook'\n";
    const deps = setup({ files: memoryHookFiles({ [HOOK]: original }) });
    const result = await installRepo(deps, "/repo");
    expect(result.chainedOriginal).toBe(true);
    expect(deps.files.files.get(ORIG)).toBe(original);
    expect(deps.files.files.get(HOOK)).toContain(`'${ORIG}'`);

    const removed = await uninstallRepo(deps, "/repo");
    expect(removed).toMatchObject({ status: "removed", restoredOriginal: true });
    expect(deps.files.files.get(HOOK)).toBe(original);
    expect(deps.files.files.has(ORIG)).toBe(false);
  });

  it("is a no-op the second time and never moves its own wrapper aside", async () => {
    const deps = setup();
    await installRepo(deps, "/repo");
    const again = await installRepo(deps, "/repo");
    expect(again.status).toBe("already_installed");
    expect(deps.files.files.has(ORIG)).toBe(false);
  });

  it("puts the user's hook back if writing the wrapper fails, so the repository is never left without a hook", async () => {
    const original = "#!/bin/sh\necho mine\n";
    const files = memoryHookFiles({ [HOOK]: original });
    const realWrite = files.writeExecutable;
    files.writeExecutable = async () => {
      throw new Error("disk full");
    };
    await expect(installRepo(setup({ files }), "/repo")).rejects.toThrow("disk full");
    files.writeExecutable = realWrite;
    expect(files.files.get(HOOK)).toBe(original);
    expect(files.files.has(ORIG)).toBe(false);
  });

  it("uninstall puts DevGuard's wrapper back if restoring the original fails", async () => {
    const files = memoryHookFiles({ [HOOK]: "#!/bin/sh\necho mine\n" });
    const deps = setup({ files });
    await installRepo(deps, "/repo");
    const wrapper = files.files.get(HOOK);
    files.move = async () => {
      throw new Error("cannot move");
    };
    await expect(uninstallRepo(deps, "/repo")).rejects.toThrow("cannot move");
    expect(files.files.get(HOOK)).toBe(wrapper);
  });

  it("refuses when a foreign hook exists and the backup name is taken, touching neither", async () => {
    const deps = setup({ files: memoryHookFiles({ [HOOK]: "#!/bin/sh\nA\n", [ORIG]: "#!/bin/sh\nB\n" }) });
    await expect(installRepo(deps, "/repo")).rejects.toMatchObject({ code: "usage_error" });
    expect(deps.files.files.get(HOOK)).toBe("#!/bin/sh\nA\n");
    expect(deps.files.files.get(ORIG)).toBe("#!/bin/sh\nB\n");
  });

  it("refuses a repository that sets its own core.hooksPath", async () => {
    const deps = setup({ git: fakeGit({ localConfig: { "/repo\0core.hooksPath": ".husky" } }) });
    await expect(installRepo(deps, "/repo")).rejects.toThrow(/core.hooksPath \(\.husky\)/);
    expect(deps.files.files.size).toBe(0);
  });

  it("refuses a path that is not a repository", async () => {
    await expect(installRepo(setup({ git: fakeGit({ repoRoot: undefined }) }), "/nowhere")).rejects.toBeInstanceOf(AgentError);
  });

  it("uninstall refuses to touch a hook without the marker", async () => {
    const deps = setup({ files: memoryHookFiles({ [HOOK]: "#!/bin/sh\necho mine\n" }) });
    await expect(uninstallRepo(deps, "/repo")).rejects.toMatchObject({ code: "usage_error" });
    expect(deps.files.files.get(HOOK)).toBe("#!/bin/sh\necho mine\n");
  });

  it("uninstall with nothing installed reports so and removes the record only if present", async () => {
    expect(await uninstallRepo(setup(), "/repo")).toMatchObject({ status: "not_installed", restoredOriginal: false });
  });

  it("uninstall forgets the record", async () => {
    const store = persistentStore();
    const deps = setup({ store });
    await installRepo(deps, "/repo");
    await uninstallRepo(deps, "/repo");
    expect(store.current().repos).toEqual([]);
    expect(deps.files.files.size).toBe(0);
  });
});
