import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PASSTHROUGH_HOOKS } from "../../src/use-cases/hook-wrapper.js";
import { UNAPPROVED, secret, World } from "./world.js";

let w: World;
beforeEach(() => void (w = new World()));
afterEach(() => w.cleanup());

const push = (...args: string[]) => w.git(["push", ...args]);
const portalBare = (): string => `${w.remotes}/acme/portal.git`;
const awsKey = (): string => "AK" + "IA" + "7".repeat(16);
const pemHeader = (): string => "-----BEGIN " + "RSA PRIVATE KEY" + "-----";

async function ready(over?: Parameters<World["protect"]>[0]): Promise<void> {
  await w.protect(over);
  expect(w.devguard(["install", "--global"]).status).toBe(0);
}

describe("the wrapper itself", () => {
  it("a remote name or URL that looks like an option is an operand: the push is evaluated, not 'helped' through", async () => {
    await ready();
    const sha = w.commit({ "a.txt": "1\n" });
    const stdin = `refs/heads/main ${sha} refs/heads/main ${"0".repeat(40)}\n`;
    for (const args of [["-h", "--help"], ["--help", "x"], ["x", "-h"]]) {
      const out = w.run("sh", [join(w.state, "hooks", "pre-push"), ...args], w.repo, stdin);
      expect(out.status).toBe(1);
      expect(out.stderr).toContain("DevGuard blocked this push.");
    }
  });

  it("every pass-through script is installed executable", async () => {
    await ready();
    for (const name of PASSTHROUGH_HOOKS) expect(statSync(join(w.state, "hooks", name)).mode & 0o777).toBe(0o755);
  });
});

describe("global git config is left exactly as it was", () => {
  const configPath = (): string => join(w.home, ".gitconfig");

  it("install then uninstall restores the file byte for byte, with and without a previous hooksPath", () => {
    w.gitOk(["config", "--global", "user.name", "Someone"]);
    w.gitOk(["config", "--global", "alias.co", "checkout"]);
    const seed = readFileSync(configPath());
    w.devguard(["install", "--global"]);
    expect(readFileSync(configPath()).equals(seed)).toBe(false);
    w.devguard(["uninstall", "--global"]);
    expect(readFileSync(configPath()).equals(seed)).toBe(true);

    w.gitOk(["config", "--global", "core.hooksPath", "/opt/team hooks"]);
    const withPrevious = readFileSync(configPath());
    w.devguard(["install", "--global"]);
    w.devguard(["uninstall", "--global"]);
    expect(readFileSync(configPath()).equals(withPrevious)).toBe(true);
  });

  it("a second install changes nothing: not the config, not the scripts' modification times", async () => {
    w.devguard(["install", "--global"]);
    const config = readFileSync(configPath());
    const scripts = ["pre-push", "pre-commit", "post-receive"].map((n) => join(w.state, "hooks", n));
    const times = scripts.map((p) => statSync(p).mtimeMs);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(w.devguard(["install", "--global"]).stdout).toContain("already installed");
    expect(readFileSync(configPath()).equals(config)).toBe(true);
    expect(scripts.map((p) => statSync(p).mtimeMs)).toEqual(times);
  });

  it("install, install again, uninstall still restores the previous hooksPath", () => {
    w.gitOk(["config", "--global", "core.hooksPath", "/opt/team"]);
    w.devguard(["install", "--global"]);
    w.devguard(["install", "--global"]);
    w.devguard(["uninstall", "--global"]);
    expect(w.gitOk(["config", "--global", "--get", "core.hooksPath"])).toBe("/opt/team");
  });
});

describe("tags", () => {
  it("lightweight and annotated tags on approved commits are allowed and recorded as tag pushes", async () => {
    await ready();
    w.commit({ "a.txt": "1\n" });
    expect(push("origin", "HEAD:refs/heads/main").status).toBe(0);
    w.gitOk(["tag", "light"]);
    w.gitOk(["tag", "-a", "annotated", "-m", "release"]);
    for (const tag of ["light", "annotated"]) {
      expect(push("origin", `refs/tags/${tag}`).status).toBe(0);
      expect(w.events().at(-1)).toMatchObject({ operation: "tag_push", outcome: "allowed" });
    }
    expect(w.refsOf(portalBare())).toContain("refs/tags/annotated");
  });

  it("an annotated tag whose history contains a secret is blocked (the tag object is peeled to its commits)", async () => {
    await ready();
    w.commit({ "k.ts": `const t = "${secret()}";\n` });
    w.gitOk(["tag", "-a", "bad", "-m", "release"]);
    w.expectBlocked(push("origin", "refs/tags/bad"), "secret: github_token  k.ts:1");
    expect(w.refsOf(portalBare())).toBe("");
  });

  it("deleting a tag is judged by destination", async () => {
    await ready();
    w.commit({ "a.txt": "1\n" });
    w.gitOk(["tag", "t1"]);
    expect(push("origin", "refs/tags/t1").status).toBe(0);
    expect(push("origin", ":refs/tags/t1").status).toBe(0);
    expect(w.refsOf(portalBare())).not.toContain("refs/tags/t1");
  });

  it("a tag that points at a file (blob) cannot be scanned, so it is blocked, not waved through as empty", async () => {
    await ready();
    writeFileSync(join(w.repo, "payload.cfg"), `token=${secret()}\n`);
    const blob = w.gitOk(["hash-object", "-w", "payload.cfg"]);
    w.gitOk(["tag", "blobtag", blob]);
    const out = push("origin", "refs/tags/blobtag");
    w.expectBlocked(out, "could not be fully checked");
    expect(w.refsOf(portalBare())).toBe("");
    expect(out.stderr).not.toContain(secret());
  });
});

describe("what is scanned", () => {
  it("a secret introduced only in a merge's conflict resolution is found", async () => {
    await ready();
    w.commit({ "config.txt": "value=base\n" });
    w.gitOk(["checkout", "-q", "-b", "side"]);
    w.commit({ "config.txt": "value=side\n" }, "side");
    w.gitOk(["checkout", "-q", "main"]);
    w.commit({ "config.txt": "value=main\n" }, "main");
    expect(w.git(["merge", "side"]).status).not.toBe(0); // conflict
    writeFileSync(join(w.repo, "config.txt"), `value="${secret()}"\n`);
    w.gitOk(["add", "config.txt"]);
    w.gitOk(["commit", "-q", "--no-edit"]);
    // Everything but the resolution is clean: push the side and main commits first, without the hook.
    const out = push("origin", "HEAD:refs/heads/main");
    w.expectBlocked(out, "config.txt:1");
    expect(w.refsOf(portalBare())).toBe("");
  });

  it("renaming a file to .env is flagged; renaming .env away is not", async () => {
    await ready();
    w.commit({ "ok.txt": "1\n" });
    expect(push("origin", "HEAD:refs/heads/main").status).toBe(0);
    w.gitOk(["mv", "ok.txt", ".env"]);
    w.gitOk(["commit", "-q", "-m", "rename to env"]);
    w.expectBlocked(push("origin", "HEAD:refs/heads/main"), "prohibited_file  .env");

    await w.protect((p) => void (p.policy.prohibitedGlobs = []));
    w.gitOk(["reset", "-q", "--hard", "HEAD"]);
    expect(push("origin", "HEAD:refs/heads/main").status).toBe(0); // .env is now on the remote
    await w.protect();
    w.gitOk(["mv", ".env", "plain.txt"]);
    w.gitOk(["commit", "-q", "-m", "rename away"]);
    expect(push("origin", "HEAD:refs/heads/main").status).toBe(0);
  });

  it.each([
    ["AWS access key", "aws_access_key_id", () => `key=${awsKey()}\n`],
    ["private key block", "private_key_block", () => `${pemHeader()}\nabc\n`],
    ["GitHub token", "github_token", () => `t=${secret()}\n`],
  ])("detects a %s end to end", async (_name, ruleId, content) => {
    await ready();
    w.commit({ "src/x.txt": content() });
    const out = push("origin", "HEAD:refs/heads/main");
    w.expectBlocked(out, `secret: ${ruleId}  src/x.txt:1`);
    expect(out.stderr).not.toContain(awsKey());
    expect(w.refsOf(portalBare())).toBe("");
  });

  it("a secret in a file Git treats as binary (NUL byte, or marked -diff by the pusher) is still found", async () => {
    await ready();
    writeFileSync(join(w.repo, "blob.dat"), Buffer.concat([Buffer.from([0]), Buffer.from(`t=${secret()}\n`)]));
    writeFileSync(join(w.repo, "hidden.cfg"), `t=${secret()}\n`);
    writeFileSync(join(w.repo, ".gitattributes"), "*.cfg -diff\n");
    w.gitOk(["add", "."]);
    w.gitOk(["commit", "-q", "-m", "binary-looking"]);
    const out = push("origin", "HEAD:refs/heads/main");
    w.expectBlocked(out, "blob.dat", "hidden.cfg");
  });

  it("a new branch does not re-flag history the remote already has (no false positives from old commits)", async () => {
    await ready();
    w.commit({ ".env": "OLD=1\n" });
    expect(w.git(["push", "--no-verify", "origin", "HEAD:refs/heads/main"]).status).toBe(0); // updates origin/main
    w.gitOk(["checkout", "-q", "-b", "feature"]);
    w.commit({ "clean.txt": "1\n" });
    expect(push("origin", "feature").status).toBe(0);
  });

  it("without remote-tracking refs the whole history is scanned again (documented: scanning more is the safe direction)", async () => {
    await ready();
    w.commit({ ".env": "OLD=1\n" });
    expect(w.git(["push", "--no-verify", "origin", "HEAD:refs/heads/main"]).status).toBe(0);
    w.gitOk(["update-ref", "-d", "refs/remotes/origin/main"]);
    w.gitOk(["checkout", "-q", "-b", "feature"]);
    w.commit({ "clean.txt": "1\n" });
    w.expectBlocked(push("origin", "feature"), ".env");
  });

  it("a force-push that rewrites history to include a secret is blocked and the force-push is shown", async () => {
    await ready();
    w.commit({ "a.txt": "1\n" });
    expect(push("origin", "HEAD:refs/heads/main").status).toBe(0);
    const before = w.refsOf(portalBare());
    writeFileSync(join(w.repo, "k.ts"), `t="${secret()}"\n`);
    w.gitOk(["add", "k.ts"]);
    w.gitOk(["commit", "-q", "--amend", "-m", "rewritten with secret"]); // not a descendant of what the remote has
    const out = push("--force", "origin", "HEAD:refs/heads/main");
    w.expectBlocked(out, "force-push", "k.ts");
    expect(w.refsOf(portalBare())).toBe(before);
  });

  it("a force-push to an unapproved destination is blocked and reported as a force-push", async () => {
    await ready();
    const bare = w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "1\n" });
    expect(w.git(["push", "--no-verify", "fork", "HEAD:refs/heads/main"]).status).toBe(0);
    w.gitOk(["commit", "-q", "--amend", "-m", "rewritten"]);
    const before = w.refsOf(bare);
    const out = push("--force", "fork", "HEAD:refs/heads/main");
    w.expectBlocked(out, "force-push");
    expect(w.refsOf(bare)).toBe(before);
    expect(w.events().at(-1)).toMatchObject({ operation: "force_push" });
  });
});

describe("which URL is judged", () => {
  it("the URL Git will actually push to, not the remote's name or its fetch URL (pushurl)", async () => {
    await ready();
    w.addRemote("fork", UNAPPROVED);
    w.gitOk(["remote", "set-url", "--push", "origin", UNAPPROVED]); // origin's fetch URL is approved, its push URL is not
    w.commit({ "a.txt": "1\n" });
    w.expectBlocked(push("origin", "HEAD:refs/heads/main"), "github.com/personal/fork");
    expect(w.refsOf(`${w.remotes}/personal/fork.git`)).toBe("");
  });

  it("pushInsteadOf rewriting an approved-looking remote to an unapproved URL is blocked, and the reverse is allowed", async () => {
    await ready();
    w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "1\n" });
    w.gitOk(["config", "url.git@github.com:personal/fork.git.pushInsteadOf", "git@github.com:acme/portal.git"]);
    w.expectBlocked(push("origin", "HEAD:refs/heads/main"), "github.com/personal/fork");

    w.gitOk(["config", "--unset", "url.git@github.com:personal/fork.git.pushInsteadOf"]);
    w.gitOk(["config", "url.git@github.com:acme/portal.git.pushInsteadOf", UNAPPROVED]);
    expect(push("fork", "HEAD:refs/heads/main").status).toBe(0);
    expect(w.refsOf(portalBare())).toContain("refs/heads/main");
  });

  it("pushing to a URL given directly (the remote 'name' is the URL) is judged and scanned the same way", async () => {
    await ready();
    w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "1\n" });
    w.expectBlocked(push(UNAPPROVED, "HEAD:refs/heads/main"), "github.com/personal/fork");
    expect(push("git@github.com:acme/portal.git", "HEAD:refs/heads/main").status).toBe(0);
    w.commit({ ".env": "S=1\n" });
    w.expectBlocked(push("git@github.com:acme/portal.git", "HEAD:refs/heads/second"), ".env");
  });

  it("other spellings of the approved destination are accepted (case, .git, ssh://)", async () => {
    await ready();
    w.commit({ "a.txt": "1\n" });
    for (const [i, url] of ["git@github.com:acme/portal", "ssh://git@github.com/acme/portal.git", "git@GitHub.com:ACME/Portal.git"].entries()) {
      w.gitOk(["remote", "add", `r${i}`, url]);
      w.gitOk(["config", `url.git@github.com:acme/portal.git.pushInsteadOf`, url]);
      expect(push(`r${i}`, `HEAD:refs/heads/b${i}`).status).toBe(0);
      w.gitOk(["config", "--unset", `url.git@github.com:acme/portal.git.pushInsteadOf`]);
    }
  });
});

describe("where the push comes from", () => {
  it("a push from a subdirectory of the work tree is protected", async () => {
    await ready();
    w.addRemote("fork", UNAPPROVED);
    w.commit({ "deep/dir/a.txt": "1\n" });
    w.expectBlocked(w.git(["push", "fork", "HEAD:refs/heads/main"], join(w.repo, "deep", "dir")), "github.com/personal/fork");
  });

  it("a push from a linked worktree of a registered repository is protected through the main checkout", async () => {
    await ready();
    w.addRemote("fork", UNAPPROVED);
    w.commit({ "a.txt": "1\n" });
    const wt = join(w.dir, "wt");
    w.gitOk(["worktree", "add", "-q", wt, "-b", "wtb"]);
    w.expectBlocked(w.git(["push", "fork", "HEAD:refs/heads/main"], wt), "github.com/personal/fork");
    expect(w.events().at(-1)).toMatchObject({ projectId: "proj-1" });
  });

  it("a repo-local pre-push still runs when pushing from a subdirectory (the chain resolves the hooks directory correctly)", async () => {
    await ready();
    mkdirSync(join(w.repo, ".git", "hooks"), { recursive: true });
    writeFileSync(join(w.repo, ".git", "hooks", "pre-push"), "#!/bin/sh\necho LOCAL-FROM-SUBDIR >&2\n", { mode: 0o755 });
    chmodSync(join(w.repo, ".git", "hooks", "pre-push"), 0o755);
    w.commit({ "deep/a.txt": "1\n" });
    const out = w.git(["push", "origin", "HEAD:refs/heads/main"], join(w.repo, "deep"));
    expect(out.status).toBe(0);
    expect(out.stderr).toContain("LOCAL-FROM-SUBDIR");
  });
});

describe("modes and failures", () => {
  it("audit-only with a secret allows the push, lists the finding, and records wouldBlock", async () => {
    await ready((p) => void (p.policy.mode = "audit_only"));
    const sha = w.commit({ "k.ts": `t="${secret()}"\n` });
    const out = push("origin", "HEAD:refs/heads/main");
    expect(out.status).toBe(0);
    expect(out.stderr).toContain("audit-only");
    expect(out.stderr).toContain("secret: github_token  k.ts:1");
    expect(out.stderr).not.toContain(secret());
    expect(w.refsOf(portalBare())).toContain(sha);
    expect(w.events().at(-1)).toMatchObject({ outcome: "allowed", wouldBlock: true, ruleIds: ["secret_detected"] });
  });

  it("audit-only cannot help when the policy itself is unreadable: the mode is unknown, so the push is blocked", async () => {
    await ready((p) => void (p.policy.mode = "audit_only"));
    const { rmSync } = await import("node:fs");
    rmSync(join(w.state, "policies"), { recursive: true, force: true });
    w.commit({ "a.txt": "1\n" });
    const out = push("origin", "HEAD:refs/heads/main");
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("blocked this push because it could not check it");
    expect(out.stderr).toContain("policy is missing or unusable");
    expect(w.events().at(-1)).toMatchObject({ outcome: "error", ruleIds: ["policy_unavailable"], mode: null });
    expect(w.refsOf(portalBare())).toBe("");
  });

  it("a broken event log never changes the decision, and the developer is told", async () => {
    await ready();
    mkdirSync(join(w.state, "events.jsonl"), { recursive: true }); // a directory where the log file should be
    w.commit({ "a.txt": "1\n" });
    const allowed = push("origin", "HEAD:refs/heads/main");
    expect(allowed.status).toBe(0);
    expect(allowed.stderr).toContain("could not record this event");

    w.addRemote("fork", UNAPPROVED);
    const blocked = push("fork", "HEAD:refs/heads/main");
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain("DevGuard blocked this push.");
    expect(blocked.stderr).toContain("could not record this event");
  });
});
