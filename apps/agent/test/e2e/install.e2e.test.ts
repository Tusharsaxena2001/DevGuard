import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APPROVED, UNAPPROVED, World } from "./world.js";

let w: World;
beforeEach(() => void (w = new World()));
afterEach(() => w.cleanup());

const hookScript = (path: string, body: string): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
};
const localHook = (name: string, body: string): void => hookScript(join(w.repo, ".git", "hooks", name), body);
const globalConfig = (): string => {
  const out = w.git(["config", "--global", "--get", "core.hooksPath"]);
  return out.status === 0 ? out.stdout.trim() : out.status === 1 ? "" : `GIT-ERROR(${out.status}): ${out.stderr}`;
};

describe("global install", () => {
  it("sets core.hooksPath to a managed 0755 hooks directory and reports it", () => {
    const out = w.devguard(["install", "--global"]);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("global hook is installed");
    expect(globalConfig()).toBe(join(w.state, "hooks"));
    expect(statSync(join(w.state, "hooks", "pre-push")).mode & 0o777).toBe(0o755);
    expect(readFileSync(join(w.state, "hooks", "pre-push"), "utf8")).toContain("DEVGUARD-MANAGED-HOOK");
  });

  it("is a no-op the second time", () => {
    w.devguard(["install", "--global"]);
    const before = readFileSync(join(w.state, "hooks", "pre-push"), "utf8");
    const again = w.devguard(["install", "--global"]);
    expect(again.stdout).toContain("already installed");
    expect(readFileSync(join(w.state, "hooks", "pre-push"), "utf8")).toBe(before);
  });

  it("applies to an existing repo and to one created afterwards", async () => {
    await w.protect();
    w.devguard(["install", "--global"]);
    w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "1\n" });
    expect(w.git(["push", "fork", "HEAD:refs/heads/main"]).stderr).toContain("DevGuard blocked this push.");

    const second = join(w.dir, "work", "second");
    w.run("git", ["init", "-q", "-b", "main", second], w.dir);
    w.run("git", ["remote", "add", "origin", UNAPPROVED], second);
    w.run("git", ["commit", "-q", "--allow-empty", "-m", "x"], second);
    // Not registered, so unprotected and allowed. Positive control: the repo's own pre-push runs only after DevGuard's wrapper ran and allowed.
    hookScript(join(second, ".git", "hooks", "pre-push"), `echo SECOND-REPO-HOOK-RAN >&2`);
    const push = w.run("git", ["push", "origin", "HEAD:refs/heads/main"], second);
    expect(push.status).toBe(0);
    expect(push.stderr).toContain("SECOND-REPO-HOOK-RAN");
  });

  it("uninstall restores an unset core.hooksPath and removes the hooks directory", () => {
    w.devguard(["install", "--global"]);
    const out = w.devguard(["uninstall", "--global"]);
    expect(out.status).toBe(0);
    expect(globalConfig()).toBe("");
    expect(existsSync(join(w.state, "hooks"))).toBe(false);
  });
});

describe("a pre-existing global core.hooksPath is preserved, chained to, and restored", () => {
  it("chains to the user's hooks directory only after DevGuard allows, and restores the value exactly", async () => {
    const mine = join(w.dir, "my-hooks");
    hookScript(join(mine, "pre-push"), `echo "MY-GLOBAL-PREPUSH args=$1|$2" >&2; cat >/dev/null; exit 0`);
    w.gitOk(["config", "--global", "core.hooksPath", mine]);
    await w.protect();
    expect(w.devguard(["install", "--global"]).stdout).toContain(`previous core.hooksPath (${mine})`);
    expect(globalConfig()).toBe(join(w.state, "hooks"));

    w.commit({ "a.txt": "1\n" });
    const allowed = w.git(["push", "origin", "HEAD:refs/heads/main"]);
    expect(allowed.status).toBe(0);
    expect(allowed.stderr).toContain(`MY-GLOBAL-PREPUSH args=origin|${APPROVED}`);

    w.addRemote("fork", UNAPPROVED);
    const blocked = w.git(["push", "fork", "HEAD:refs/heads/main"]);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).not.toContain("MY-GLOBAL-PREPUSH"); // not run when DevGuard blocks

    w.devguard(["uninstall", "--global"]);
    expect(globalConfig()).toBe(mine);
  });

  it("a failing user hook still blocks the push, and receives the same stdin", async () => {
    const mine = join(w.dir, "my-hooks");
    hookScript(join(mine, "pre-push"), `cat >&2; exit 7`);
    w.gitOk(["config", "--global", "core.hooksPath", mine]);
    await w.protect();
    w.devguard(["install", "--global"]);
    const sha = w.commit({ "a.txt": "1\n" });
    const push = w.git(["push", "origin", "HEAD:refs/heads/main"]);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain(`HEAD ${sha} refs/heads/main`);
  });

  it("other hooks of the user's directory keep running through pass-through", () => {
    const mine = join(w.dir, "my-hooks");
    hookScript(join(mine, "pre-commit"), `echo MY-PRECOMMIT >&2`);
    w.gitOk(["config", "--global", "core.hooksPath", mine]);
    w.devguard(["install", "--global"]);
    w.commit({ "a.txt": "1\n" });
    w.gitOk(["config", "user.email", "t@example.com"]);
    const c = w.git(["commit", "-q", "--allow-empty", "-m", "again"]);
    expect(c.stderr).toContain("MY-PRECOMMIT");
  });
});

describe("repo-local hooks keep working under the global hook", () => {
  it("the repository's own pre-push still runs after DevGuard allows, with the same arguments and stdin", async () => {
    localHook("pre-push", `echo "LOCAL-PREPUSH $1 $2" >&2; cat >&2`);
    await w.protect();
    w.devguard(["install", "--global"]);
    const sha = w.commit({ "a.txt": "1\n" });
    const push = w.git(["push", "origin", "HEAD:refs/heads/main"]);
    expect(push.status).toBe(0);
    expect(push.stderr).toContain(`LOCAL-PREPUSH origin ${APPROVED}`);
    expect(push.stderr).toContain(`HEAD ${sha} refs/heads/main`);
  });

  it("a failing repo-local pre-push still blocks the push", async () => {
    localHook("pre-push", `exit 3`);
    await w.protect();
    w.devguard(["install", "--global"]);
    w.commit({ "a.txt": "1\n" });
    expect(w.git(["push", "origin", "HEAD:refs/heads/main"]).status).not.toBe(0);
  });

  it("the repository's other local hooks (pre-commit, commit-msg) are not silently disabled", () => {
    localHook("pre-commit", `echo LOCAL-PRECOMMIT >&2`);
    localHook("commit-msg", `echo "LOCAL-COMMITMSG $(basename "$1")" >&2`);
    w.devguard(["install", "--global"]);
    w.commit({ "a.txt": "1\n" });
    const c = w.git(["commit", "-q", "--allow-empty", "-m", "again"]);
    expect(c.stderr).toContain("LOCAL-PRECOMMIT");
    expect(c.stderr).toContain("LOCAL-COMMITMSG COMMIT_EDITMSG");
  });

  it("without DevGuard installed those hooks behave the same (baseline) and after uninstall they are back to normal", () => {
    localHook("pre-commit", `echo LOCAL-PRECOMMIT >&2`);
    w.devguard(["install", "--global"]);
    w.devguard(["uninstall", "--global"]);
    w.commit({ "a.txt": "1\n" });
    expect(w.git(["commit", "-q", "--allow-empty", "-m", "again"]).stderr).toContain("LOCAL-PRECOMMIT");
  });
});

describe("status reports hook state and overrides", () => {
  it("shows the global hook and detects a repo-level core.hooksPath override that bypasses it", () => {
    w.devguard(["install", "--global"]);
    expect(w.devguard(["status"]).stdout).toContain("Global hook: installed");
    w.gitOk(["config", "core.hooksPath", ".husky"]);
    const status = w.devguard(["status"]);
    expect(status.status).toBe(2);
    expect(status.stdout).toContain("OVERRIDDEN by core.hooksPath=.husky");
    expect(status.stdout).toContain("DevGuard's hook does not run in this repository");
  });

  it("a repo-level override really does bypass the global hook (documented, reported, not prevented)", async () => {
    await w.protect();
    w.devguard(["install", "--global"]);
    w.gitOk(["config", "core.hooksPath", ".husky"]);
    const bare = w.addRemote("fork", UNAPPROVED);
    const sha = w.commit({ "a.txt": "1\n" });
    expect(w.git(["push", "fork", "HEAD:refs/heads/main"]).status).toBe(0);
    expect(w.refsOf(bare)).toContain(sha);
  });

  it("detects drift when the global core.hooksPath is changed after install", () => {
    w.devguard(["install", "--global"]);
    w.gitOk(["config", "--global", "core.hooksPath", "/elsewhere"]);
    const status = w.devguard(["status"]);
    expect(status.status).toBe(2);
    expect(status.stdout).toContain("NOT ACTIVE");
  });

  it("--json includes the hook section", () => {
    w.devguard(["install", "--global"]);
    const report = JSON.parse(w.devguard(["status", "--json"]).stdout) as { hooks: { global: string } };
    expect(report.hooks.global).toBe("installed");
  });
});

describe("per-repo install", () => {
  const hookPath = (): string => join(w.repo, ".git", "hooks", "pre-push");

  it("installs into the repository's hooks directory and blocks there", async () => {
    await w.protect();
    expect(w.devguard(["install", "--repo", w.repo]).stdout).toContain("installed in this repository");
    expect(statSync(hookPath()).mode & 0o777).toBe(0o755);
    w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "1\n" });
    expect(w.git(["push", "fork", "HEAD:refs/heads/main"]).stderr).toContain("DevGuard blocked this push.");
    expect(globalConfig()).toBe(""); // global config untouched
  });

  it("keeps an existing hook (mode preserved), chains to it, and restores it byte for byte", async () => {
    const original = `#!/bin/sh\necho ORIGINAL-HOOK >&2\nexit 0\n`;
    writeFileSync(hookPath(), original, { mode: 0o750 });
    chmodSync(hookPath(), 0o750);
    await w.protect();
    w.devguard(["install", "--repo", w.repo]);
    expect(readFileSync(`${hookPath()}.devguard-orig`, "utf8")).toBe(original);
    expect(statSync(`${hookPath()}.devguard-orig`).mode & 0o777).toBe(0o750);

    w.commit({ "a.txt": "1\n" });
    const push = w.git(["push", "origin", "HEAD:refs/heads/main"]);
    expect(push.status).toBe(0);
    expect(push.stderr).toContain("ORIGINAL-HOOK");

    w.devguard(["uninstall", "--repo", w.repo]);
    expect(readFileSync(hookPath(), "utf8")).toBe(original);
    expect(statSync(hookPath()).mode & 0o777).toBe(0o750);
    expect(existsSync(`${hookPath()}.devguard-orig`)).toBe(false);
  });

  it("is a no-op the second time, and uninstall refuses to touch a hook it did not write", () => {
    w.devguard(["install", "--repo", w.repo]);
    expect(w.devguard(["install", "--repo", w.repo]).stdout).toContain("already installed");
    w.devguard(["uninstall", "--repo", w.repo]);
    writeFileSync(hookPath(), "#!/bin/sh\necho mine\n", { mode: 0o755 });
    const out = w.devguard(["uninstall", "--repo", w.repo]);
    expect(out.status).toBe(2);
    expect(readFileSync(hookPath(), "utf8")).toBe("#!/bin/sh\necho mine\n");
  });

  it("refuses a repository that sets core.hooksPath", () => {
    w.gitOk(["config", "core.hooksPath", ".husky"]);
    const out = w.devguard(["install", "--repo", w.repo]);
    expect(out.status).toBe(2);
    expect(out.stderr).toContain("sets core.hooksPath (.husky)");
  });

  it("works from a git worktree (hooks live in the shared common directory)", () => {
    w.commit({ "a.txt": "1\n" });
    const wt = join(w.dir, "wt");
    w.gitOk(["worktree", "add", "-q", wt, "-b", "wtb"]);
    expect(w.devguard(["install", "--repo", wt]).status).toBe(0);
    expect(existsSync(hookPath())).toBe(true);
  });

  it("rejects a path that is not a repository", () => {
    expect(w.devguard(["install", "--repo", w.dir]).status).toBe(2);
  });
});
