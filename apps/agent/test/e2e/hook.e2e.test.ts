import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UNAPPROVED, secret, World } from "./world.js";

let w: World;
beforeEach(() => void (w = new World()));
afterEach(() => w.cleanup());

async function installed(): Promise<void> {
  expect(w.devguard(["install", "--global"]).status).toBe(0);
}

describe("protected push through the real global hook", () => {
  it("an approved destination with clean commits succeeds and the remote receives it", async () => {
    await w.protect();
    await installed();
    const sha = w.commit({ "src/a.ts": "export const a = 1;\n" });
    const push = w.git(["push", "origin", "HEAD:refs/heads/main"]);
    expect(push.status).toBe(0);
    expect(w.refsOf(`${w.remotes}/acme/portal.git`)).toContain(`refs/heads/main ${sha}`);
    expect(w.events().at(-1)).toMatchObject({ outcome: "allowed", projectId: "proj-1", operation: "branch_create" });
  });

  it("an unapproved destination is blocked with an explanation and the bare repo is unchanged", async () => {
    await w.protect();
    await installed();
    const bare = w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "x\n" });
    const before = w.refsOf(bare);
    const push = w.git(["push", "fork", "HEAD:refs/heads/main"]);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("DevGuard blocked this push.");
    expect(push.stderr).toContain("Destination: github.com/personal/fork");
    expect(push.stderr).toContain("Reference:");
    expect(w.refsOf(bare)).toBe(before);
    expect(w.events().at(-1)).toMatchObject({ outcome: "blocked", ruleIds: ["destination_not_approved"] });
  });

  it("a rewired remote is still caught: origin pointed at a personal repo is blocked", async () => {
    await w.protect();
    await installed();
    w.addRemote("fork", UNAPPROVED);
    w.gitOk(["remote", "set-url", "origin", UNAPPROVED]);
    w.commit({ "a.txt": "x\n" });
    w.expectBlocked(w.git(["push", "origin", "HEAD:refs/heads/main"]), "github.com/personal/fork");
    expect(w.refsOf(`${w.remotes}/personal/fork.git`)).toBe("");
  });

  it("a secret added and then deleted within the pushed history is still detected", async () => {
    await w.protect();
    await installed();
    w.commit({ "config.ts": `export const token = "${secret()}";\n` }, "add token");
    w.commit({ "config.ts": "export const token = process.env.TOKEN;\n" }, "remove token");
    const bare = `${w.remotes}/acme/portal.git`;
    const push = w.git(["push", "origin", "HEAD:refs/heads/main"]);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("secret: github_token  config.ts:1");
    expect(push.stderr).not.toContain(secret());
    expect(w.refsOf(bare)).toBe("");
    expect(JSON.stringify(w.events())).not.toContain(secret());
  });

  it("a prohibited file is blocked, and deleting it later does not remove the finding for the commit that added it", async () => {
    await w.protect();
    await installed();
    w.commit({ ".env": "A=1\n" }, "add env");
    w.commit({ ".env": null }, "remove env");
    const push = w.git(["push", "origin", "HEAD:refs/heads/main"]);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("prohibited file: prohibited_file  .env");
  });

  it("removing a .env that is already on the remote is not blocked (that is the fix)", async () => {
    await w.protect((p) => void (p.policy.prohibitedGlobs = []));
    await installed();
    w.commit({ ".env": "A=1\n" });
    expect(w.git(["push", "origin", "HEAD:refs/heads/main"]).status).toBe(0);
    await w.protect();
    w.commit({ ".env": null }, "remove env");
    expect(w.git(["push", "origin", "HEAD:refs/heads/main"]).status).toBe(0);
  });

  it("new branches scan only commits the remote does not have", async () => {
    await w.protect();
    await installed();
    w.commit({ "a.txt": "1\n" });
    expect(w.git(["push", "origin", "HEAD:refs/heads/main"]).status).toBe(0);
    w.gitOk(["checkout", "-q", "-b", "feature"]);
    w.commit({ ".env": "S=1\n" });
    const push = w.git(["push", "origin", "feature"]);
    w.expectBlocked(push, ".env");
  });

  it("a multi-ref push is blocked as a whole when one ref violates, and nothing is pushed", async () => {
    await w.protect();
    await installed();
    const bare = `${w.remotes}/acme/portal.git`;
    w.commit({ "ok.txt": "1\n" });
    w.gitOk(["branch", "good"]);
    w.commit({ "bad.pem": "KEY\n" });
    w.gitOk(["branch", "bad"]);
    const push = w.git(["push", "origin", "good", "bad"]);
    w.expectBlocked(push, "prohibited_file", "bad.pem");
    expect(w.refsOf(bare)).toBe("");
    expect(w.events().at(-1)).toMatchObject({ refs: ["refs/heads/good", "refs/heads/bad"], ruleIds: ["prohibited_file"] });
  });

  it("detects a force-push and still evaluates it", async () => {
    await w.protect();
    await installed();
    w.commit({ "a.txt": "1\n" });
    expect(w.git(["push", "origin", "HEAD:refs/heads/main"]).status).toBe(0);
    w.gitOk(["commit", "-q", "--amend", "-m", "rewritten"]);
    expect(w.git(["push", "--force", "origin", "HEAD:refs/heads/main"]).status).toBe(0);
    expect(w.events().at(-1)).toMatchObject({ operation: "force_push", outcome: "allowed" });
  });

  it("branch deletion is judged by destination: allowed to the approved remote, blocked elsewhere", async () => {
    await w.protect();
    await installed();
    w.commit({ "a.txt": "1\n" });
    expect(w.git(["push", "origin", "HEAD:refs/heads/temp"]).status).toBe(0);
    expect(w.git(["push", "origin", "--delete", "temp"]).status).toBe(0);
    expect(w.events().at(-1)).toMatchObject({ operation: "branch_delete", outcome: "allowed" });
    expect(w.refsOf(`${w.remotes}/acme/portal.git`)).not.toContain("refs/heads/temp");

    w.addRemote("fork", UNAPPROVED);
    w.gitOk(["push", "--no-verify", "fork", "HEAD:refs/heads/temp"]);
    const forkBare = `${w.remotes}/personal/fork.git`;
    const del = w.git(["push", "fork", "--delete", "temp"]);
    w.expectBlocked(del, "github.com/personal/fork");
    expect(w.refsOf(forkBare)).toContain("refs/heads/temp"); // the branch is still there
  });

  it("audit-only allows the push, records that it would have been blocked, and prints a notice", async () => {
    await w.protect((p) => void (p.policy.mode = "audit_only"));
    await installed();
    const bare = w.addRemote("fork", UNAPPROVED);
    const sha = w.commit({ "a.txt": "1\n" });
    const push = w.git(["push", "fork", "HEAD:refs/heads/main"]);
    expect(push.status).toBe(0);
    expect(push.stderr).toContain("audit-only");
    expect(w.refsOf(bare)).toContain(sha);
    expect(w.events().at(-1)).toMatchObject({ outcome: "allowed", wouldBlock: true, mode: "audit_only" });
  });

  it("a repo that is not assigned to any project is not protected: pushes anywhere, no events (ADR-003)", async () => {
    await installed();
    // Positive control: this repo's own pre-push runs only if the DevGuard hook ran first and allowed the push.
    const { writeFileSync, chmodSync } = await import("node:fs");
    writeFileSync(`${w.repo}/.git/hooks/pre-push`, "#!/bin/sh\necho RAN-BEHIND-DEVGUARD >&2\n", { mode: 0o755 });
    chmodSync(`${w.repo}/.git/hooks/pre-push`, 0o755);
    const bare = w.addRemote("fork", UNAPPROVED);
    const sha = w.commit({ ".env": `T=${secret()}\n` });
    const push = w.git(["push", "fork", "HEAD:refs/heads/main"]);
    expect(push.status).toBe(0);
    expect(push.stderr).toContain("RAN-BEHIND-DEVGUARD");
    expect(w.refsOf(bare)).toContain(sha);
    expect(w.events()).toEqual([]);
  });

  it("fails closed when the registered project's cached policy is missing", async () => {
    await w.protect();
    await installed();
    const { rmSync } = await import("node:fs");
    rmSync(`${w.state}/policies`, { recursive: true, force: true });
    w.commit({ "a.txt": "1\n" });
    const push = w.git(["push", "origin", "HEAD:refs/heads/main"]);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("policy is missing or unusable");
    expect(w.events().at(-1)).toMatchObject({ outcome: "error", ruleIds: ["policy_unavailable"] });
  });

  describe("a cached server policy older than the staleness limit (ADR-004)", () => {
    const hoursAgo = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();

    it("blocks an enforced protected repo even though the destination is approved; the remote is unchanged", async () => {
      await w.protect(undefined, { source: "server", fetchedAt: hoursAgo(3) });
      await installed();
      w.commit({ "a.txt": "1\n" });
      const bare = `${w.remotes}/acme/portal.git`;
      const push = w.git(["push", "origin", "HEAD:refs/heads/main"]);
      expect(push.status).not.toBe(0);
      expect(push.stderr).toContain("DevGuard blocked this push");
      expect(push.stderr).toContain("out of date");
      expect(w.refsOf(bare)).toBe("");
      expect(w.events().at(-1)).toMatchObject({ outcome: "blocked", ruleIds: ["policy_unavailable"], mode: "enforce" });
    });

    it("allows an audit-only repo but records that it would have blocked", async () => {
      await w.protect((p) => void (p.policy.mode = "audit_only"), { source: "server", fetchedAt: hoursAgo(3) });
      await installed();
      const sha = w.commit({ "a.txt": "1\n" });
      const push = w.git(["push", "origin", "HEAD:refs/heads/main"]);
      expect(push.status).toBe(0);
      expect(w.refsOf(`${w.remotes}/acme/portal.git`)).toContain(sha);
      expect(w.events().at(-1)).toMatchObject({ outcome: "allowed", ruleIds: ["policy_unavailable"], wouldBlock: true, mode: "audit_only" });
    });

    it("control: the same policy synced just now is used normally", async () => {
      await w.protect(undefined, { source: "server", fetchedAt: new Date().toISOString() });
      await installed();
      const sha = w.commit({ "a.txt": "1\n" });
      expect(w.git(["push", "origin", "HEAD:refs/heads/main"]).status).toBe(0);
      expect(w.refsOf(`${w.remotes}/acme/portal.git`)).toContain(sha);
    });
  });

  it("fails closed when the state directory is writable by others (untrusted)", async () => {
    await w.protect();
    await installed();
    const { chmodSync } = await import("node:fs");
    chmodSync(w.state, 0o777);
    w.commit({ "a.txt": "1\n" });
    const push = w.git(["push", "origin", "HEAD:refs/heads/main"]);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("could not check it");
  });
});

describe("the wrapper is not fooled by the environment at push time", () => {
  it("DEVGUARD_HOME pointing at empty state cannot turn a blocked push into an allowed one", async () => {
    await w.protect();
    await installed();
    const bare = w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "1\n" });
    w.expectBlocked(w.git(["push", "fork", "HEAD:refs/heads/main"]), "github.com/personal/fork");
    const spoofed = w.run("env", [`DEVGUARD_HOME=${w.dir}/empty`, "git", "push", "fork", "HEAD:refs/heads/main"]);
    expect(spoofed.stderr).toContain("DevGuard blocked this push.");
    expect(spoofed.status).not.toBe(0);
    expect(w.refsOf(bare)).toBe("");
    const { existsSync } = await import("node:fs");
    expect(existsSync(`${w.dir}/empty`)).toBe(false); // the spoofed home was never even touched
  });

  it("a missing agent blocks the push with instructions instead of allowing it", async () => {
    await w.protect();
    await installed();
    const { rmSync, readFileSync } = await import("node:fs");
    const wrapper = readFileSync(`${w.state}/hooks/pre-push`, "utf8");
    expect(wrapper).toContain("DG_MAIN=");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${w.state}/hooks/pre-push`, wrapper.replace(/DG_MAIN='[^']*'/, "DG_MAIN='/nonexistent/main.js'"), { mode: 0o755 });
    w.commit({ "a.txt": "1\n" });
    const push = w.git(["push", "origin", "HEAD:refs/heads/main"]);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("the agent was not found");
    expect(push.stderr).toContain("git config --global --unset core.hooksPath");
    expect(w.refsOf(`${w.remotes}/acme/portal.git`)).toBe("");
    void rmSync;
  });

  it("--no-verify skips the hook (documented limitation; DevGuard cannot prevent it)", async () => {
    await w.protect();
    await installed();
    const bare = w.addRemote("fork", UNAPPROVED);
    const sha = w.commit({ "a.txt": "1\n" });
    expect(w.git(["push", "--no-verify", "fork", "HEAD:refs/heads/main"]).status).toBe(0);
    expect(w.refsOf(bare)).toContain(sha);
  });
});
