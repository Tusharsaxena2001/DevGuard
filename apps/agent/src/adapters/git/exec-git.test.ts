import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentError } from "../../errors.js";
import type { GitPort } from "../../ports/git.js";
import { commit, git, initRepo } from "../../../test/support/git-repo.js";
import { createGit } from "./exec-git.js";

let root: string;
let repo: string;
let port: GitPort;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "devguard-git-"));
  repo = initRepo(join(root, "repo"));
  port = createGit({ cwd: repo });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("configuration", () => {
  it("reads, writes and unsets the global config in the sandbox only", async () => {
    expect(process.env["GIT_CONFIG_GLOBAL"]).toContain("devguard-sandbox-");
    expect(await port.globalConfigGet("core.hooksPath")).toBeUndefined();
    await port.globalConfigSet("core.hooksPath", "/some/dir");
    expect(await port.globalConfigGet("core.hooksPath")).toBe("/some/dir");
    expect(readFileSync(process.env["GIT_CONFIG_GLOBAL"] ?? "", "utf8")).toContain("hooksPath = /some/dir");
    await port.globalConfigUnset("core.hooksPath");
    expect(await port.globalConfigGet("core.hooksPath")).toBeUndefined();
  });

  it("unsetting a key that is not set is not an error", async () => {
    await expect(port.globalConfigUnset("core.hooksPath")).resolves.toBeUndefined();
  });

  it("values with spaces, quotes and leading dashes survive (no shell, no option injection)", async () => {
    for (const value of ["/with space/it's", "-x", '"quoted"', "~/x"]) {
      await port.globalConfigSet("core.hooksPath", value);
      expect(await port.globalConfigGet("core.hooksPath")).toBe(value);
    }
    await port.globalConfigUnset("core.hooksPath");
  });

  it("reads only the repository's local config for localConfigGet", async () => {
    await port.globalConfigSet("core.hooksPath", "/global");
    expect(await port.localConfigGet(repo, "core.hooksPath")).toBeUndefined();
    git(repo, ["config", "core.hooksPath", ".husky"]);
    expect(await port.localConfigGet(repo, "core.hooksPath")).toBe(".husky");
    await port.globalConfigUnset("core.hooksPath");
  });
});

describe("repository location", () => {
  it("finds the top level from a subdirectory", async () => {
    commit(repo, { "a/b/c.txt": "x" });
    expect(await port.repoRoot(join(repo, "a", "b"))).toBe(git(repo, ["rev-parse", "--show-toplevel"]));
  });

  it("is undefined outside a repository", async () => {
    mkdirSync(join(root, "plain"));
    expect(await port.repoRoot(join(root, "plain"))).toBeUndefined();
  });

  it("falls back to the git dir for a bare repository", async () => {
    const bare = initRepo(join(root, "bare.git"), { bare: true });
    expect(await port.repoRoot(bare)).toBe(git(bare, ["rev-parse", "--absolute-git-dir"]));
  });

  it("a worktree resolves to its own top level and shares the main repo's hooks directory", async () => {
    commit(repo, { f: "1" });
    git(repo, ["worktree", "add", "-q", join(root, "wt"), "-b", "wtb"]);
    expect(await port.repoRoot(join(root, "wt"))).toBe(git(join(root, "wt"), ["rev-parse", "--show-toplevel"]));
    expect(await port.defaultHooksDir(join(root, "wt"))).toBe(await port.defaultHooksDir(repo));
  });
});

describe("hooks directories", () => {
  it("default and effective are the repo's .git/hooks, as absolute paths", async () => {
    const expected = join(git(repo, ["rev-parse", "--absolute-git-dir"]), "hooks");
    expect(await port.defaultHooksDir(repo)).toBe(expected);
    expect(await port.effectiveHooksDir(repo)).toBe(expected);
  });

  it("effective follows a repo-level core.hooksPath while default does not", async () => {
    git(repo, ["config", "core.hooksPath", ".husky"]);
    expect(await port.effectiveHooksDir(repo)).toBe(join(repo, ".husky"));
    expect(await port.defaultHooksDir(repo)).toBe(join(git(repo, ["rev-parse", "--absolute-git-dir"]), "hooks"));
  });

  it("effective follows a global core.hooksPath (including ~)", async () => {
    await port.globalConfigSet("core.hooksPath", "/opt/hooks");
    expect(await port.effectiveHooksDir(repo)).toBe("/opt/hooks");
    await port.globalConfigUnset("core.hooksPath");
  });
});

describe("object types and worktrees", () => {
  it("peeledObjectType sees through annotated tags and tells commits from blobs and trees", async () => {
    const sha = commit(repo, { "f.txt": "x\n" });
    git(repo, ["tag", "-a", "v1", "-m", "annotated"]);
    const tagObject = git(repo, ["rev-parse", "v1"]);
    expect(tagObject).not.toBe(sha);
    expect(await port.peeledObjectType(sha)).toBe("commit");
    expect(await port.peeledObjectType(tagObject)).toBe("commit");
    expect(await port.peeledObjectType(git(repo, ["rev-parse", "HEAD:f.txt"]))).toBe("blob");
    expect(await port.peeledObjectType(git(repo, ["rev-parse", "HEAD^{tree}"]))).toBe("tree");
    expect(await port.peeledObjectType("f".repeat(40))).toBeUndefined();
    expect(await port.peeledObjectType("--help")).toBeUndefined();
  });

  it("mainWorktreeRoot is the main checkout from the root, a subdirectory and a linked worktree", async () => {
    commit(repo, { "sub/f.txt": "x\n" });
    const main = git(repo, ["rev-parse", "--show-toplevel"]);
    git(repo, ["worktree", "add", "-q", join(root, "wt"), "-b", "wtb"]);
    expect(await port.mainWorktreeRoot(repo)).toBe(main);
    expect(await port.mainWorktreeRoot(join(repo, "sub"))).toBe(main);
    expect(await port.mainWorktreeRoot(join(root, "wt"))).toBe(main);
    expect(await port.repoRoot(join(root, "wt"))).not.toBe(main);
  });

  it("mainWorktreeRoot of a bare repository is the repository itself, and undefined outside a repository", async () => {
    const bare = initRepo(join(root, "bare.git"), { bare: true });
    expect(await port.mainWorktreeRoot(bare)).toBe(git(bare, ["rev-parse", "--absolute-git-dir"]));
    mkdirSync(join(root, "plain"));
    expect(await port.mainWorktreeRoot(join(root, "plain"))).toBeUndefined();
  });
});

describe("object and ancestry queries", () => {
  it("objectExists", async () => {
    const sha = commit(repo, { f: "1" });
    expect(await port.objectExists(sha)).toBe(true);
    expect(await port.objectExists("f".repeat(40))).toBe(false);
    expect(await port.objectExists("not-a-sha")).toBe(false);
    expect(await port.objectExists("HEAD")).toBe(false); // only full object ids are accepted
    expect(await port.objectExists("--help")).toBe(false);
  });

  it("isAncestor", async () => {
    const one = commit(repo, { f: "1" });
    const two = commit(repo, { f: "2" });
    git(repo, ["checkout", "-q", "-b", "side", one]);
    const side = commit(repo, { g: "x" });
    expect(await port.isAncestor(one, two)).toBe(true);
    expect(await port.isAncestor(two, one)).toBe(false);
    expect(await port.isAncestor(two, side)).toBe(false);
    expect(await port.isAncestor("f".repeat(40), two)).toBe(false);
    expect(await port.isAncestor("--all", two)).toBe(false);
  });
});

describe("listCommits", () => {
  it("returns remote..local for a known remote commit", async () => {
    const one = commit(repo, { f: "1" });
    const two = commit(repo, { f: "2" });
    const three = commit(repo, { f: "3" });
    expect(await port.listCommits(three, { kind: "commit", sha: one }, 10)).toEqual({ commits: [three, two], truncated: false });
  });

  it("returns everything not reachable from the remote's tracking refs for a new branch", async () => {
    const one = commit(repo, { f: "1" });
    git(repo, ["update-ref", "refs/remotes/origin/main", one]);
    const two = commit(repo, { f: "2" });
    expect(await port.listCommits(two, { kind: "remote", name: "origin" }, 10)).toEqual({ commits: [two], truncated: false });
    expect((await port.listCommits(two, { kind: "remote", name: "other" }, 10)).commits).toEqual([two, one]);
  });

  it("a remote name that is a URL matches no tracking refs, so the whole history is scanned", async () => {
    const one = commit(repo, { f: "1" });
    const two = commit(repo, { f: "2" });
    expect((await port.listCommits(two, { kind: "remote", name: "git@github.com:acme/portal.git" }, 10)).commits).toEqual([two, one]);
  });

  it("reports truncation instead of silently cutting", async () => {
    commit(repo, { f: "1" });
    commit(repo, { f: "2" });
    const three = commit(repo, { f: "3" });
    const result = await port.listCommits(three, { kind: "remote", name: "none" }, 2);
    expect(result.commits).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("rejects anything that is not a full object id", async () => {
    await expect(port.listCommits("--all", { kind: "remote", name: "origin" }, 5)).rejects.toBeInstanceOf(AgentError);
    await expect(port.listCommits("a".repeat(40), { kind: "commit", sha: "--exec=x" }, 5)).rejects.toBeInstanceOf(AgentError);
  });
});

describe("changedPaths", () => {
  it("reports added, modified, deleted paths and handles the root commit", async () => {
    const root1 = commit(repo, { "a.txt": "1", "dir/b.txt": "1" });
    expect(await port.changedPaths(root1)).toEqual([
      { status: "A", path: "a.txt" },
      { status: "A", path: "dir/b.txt" },
    ]);
    const two = commit(repo, { "a.txt": "2", "dir/b.txt": null, "c.txt": "new" });
    expect(await port.changedPaths(two)).toEqual([
      { status: "M", path: "a.txt" },
      { status: "A", path: "c.txt" },
      { status: "D", path: "dir/b.txt" },
    ]);
  });

  it("returns unusual file names exactly (spaces, quotes, newlines, unicode)", async () => {
    const names = ["my file.txt", 'say "hi".txt', "café/中.txt", "new\nline.txt", "tab\there.txt"];
    const sha = commit(repo, Object.fromEntries(names.map((n) => [n, "x"])));
    expect((await port.changedPaths(sha)).map((c) => c.path).sort()).toEqual([...names].sort());
  });

  it("covers a merge commit's changes relative to each parent", async () => {
    commit(repo, { base: "1" });
    git(repo, ["checkout", "-q", "-b", "feature"]);
    commit(repo, { "feature.env": "S" });
    git(repo, ["checkout", "-q", "main"]);
    commit(repo, { "main.txt": "m" });
    git(repo, ["merge", "-q", "--no-ff", "-m", "merge", "feature"]);
    const merge = git(repo, ["rev-parse", "HEAD"]);
    const paths = (await port.changedPaths(merge)).map((c) => c.path);
    expect(paths).toContain("feature.env");
    expect(paths).toContain("main.txt");
  });

  it("an empty commit changes nothing", async () => {
    commit(repo, { f: "1" });
    expect(await port.changedPaths(commit(repo, {}))).toEqual([]);
  });
});

describe("addedLines", () => {
  it("returns added lines with new-file line numbers; removed and context lines are not included", async () => {
    commit(repo, { "src/a.ts": "one\ntwo\nthree\n" });
    const sha = commit(repo, { "src/a.ts": "one\nTWO\nthree\nfour\n" });
    expect(await port.addedLines(sha)).toEqual([
      { path: "src/a.ts", line: 2, text: "TWO" },
      { path: "src/a.ts", line: 4, text: "four" },
    ]);
  });

  it("covers the root commit and new files", async () => {
    const sha = commit(repo, { "a.txt": "hello\nworld\n" });
    expect(await port.addedLines(sha)).toEqual([
      { path: "a.txt", line: 1, text: "hello" },
      { path: "a.txt", line: 2, text: "world" },
    ]);
  });

  it("attributes lines to the right file for unusual names", async () => {
    const names = ["my file.txt", 'say "hi".txt', "café/中.txt", "tab\there.txt"];
    const sha = commit(repo, Object.fromEntries(names.map((n) => [n, `content of ${n}\n`])));
    const lines = await port.addedLines(sha);
    expect(lines.map((l) => l.path).sort()).toEqual([...names].sort());
    for (const l of lines) expect(l.text).toBe(`content of ${l.path}`);
  });

  it("finds a line whose text looks like a diff header", async () => {
    const sha = commit(repo, { f: "+++ b/evil\n@@ -1 +1 @@\n" });
    expect((await port.addedLines(sha)).map((l) => l.text)).toEqual(["+++ b/evil", "@@ -1 +1 @@"]);
  });

  it("yields nothing for deletions and empty commits", async () => {
    commit(repo, { t: "text\n" });
    expect(await port.addedLines(commit(repo, { t: null }))).toEqual([]);
    expect(await port.addedLines(commit(repo, {}))).toEqual([]);
  });

  it("still returns lines from files Git calls binary: a NUL byte or a pusher-controlled -diff attribute must not hide a secret", async () => {
    writeFileSync(join(repo, "nul.txt"), Buffer.concat([Buffer.from([0]), Buffer.from("password=hunter2\n")]));
    writeFileSync(join(repo, "a.cfg"), "token=abc123\n");
    writeFileSync(join(repo, ".gitattributes"), "*.cfg -diff\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "hidden"]);
    const texts = (await port.addedLines(git(repo, ["rev-parse", "HEAD"]))).map((l) => `${l.path}:${l.text}`);
    expect(texts.some((t) => t.startsWith("nul.txt:") && t.includes("password=hunter2"))).toBe(true);
    expect(texts).toContain("a.cfg:token=abc123");
  });

  it("covers a merge commit's own changes", async () => {
    commit(repo, { base: "1\n" });
    git(repo, ["checkout", "-q", "-b", "feature"]);
    commit(repo, { "f.txt": "feature line\n" });
    git(repo, ["checkout", "-q", "main"]);
    commit(repo, { "m.txt": "main line\n" });
    git(repo, ["merge", "-q", "--no-ff", "-m", "merge", "feature"]);
    const texts = (await port.addedLines(git(repo, ["rev-parse", "HEAD"]))).map((l) => l.text);
    expect(texts).toContain("feature line");
  });

  it("never runs programs configured in the repository (diff.external, textconv)", async () => {
    const marker = join(root, "PWNED");
    const script = join(root, "evil.sh");
    writeFileSync(script, `#!/bin/sh\necho ran >> ${marker}\ncat "$1" 2>/dev/null\n`);
    chmodSync(script, 0o755);
    git(repo, ["config", "diff.external", script]);
    git(repo, ["config", "diff.evil.textconv", script]);
    writeFileSync(join(repo, ".gitattributes"), "* diff=evil\n");
    git(repo, ["add", ".gitattributes"]);
    const sha = commit(repo, { "a.txt": "line\n" });
    await port.addedLines(sha);
    await port.changedPaths(sha);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("failures", () => {
  it("throws a typed error without output when git fails, e.g. outside a repository", async () => {
    mkdirSync(join(root, "plain"));
    const error = await createGit().effectiveHooksDir(join(root, "plain")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).code).toBe("git_failed");
    expect((error as AgentError).message).not.toContain(root);
  });

  it("rejects non-hex ids for diff commands before running git", async () => {
    for (const bad of ["HEAD", "--output=/tmp/x", "abc", "A".repeat(40)]) {
      await expect(port.changedPaths(bad)).rejects.toBeInstanceOf(AgentError);
      await expect(port.addedLines(bad)).rejects.toBeInstanceOf(AgentError);
    }
  });

  it("a commit id that does not exist is an error, not an empty result", async () => {
    commit(repo, { f: "1" });
    await expect(port.changedPaths("f".repeat(40))).rejects.toBeInstanceOf(AgentError);
    await expect(port.addedLines("f".repeat(40))).rejects.toBeInstanceOf(AgentError);
    await expect(port.listCommits("f".repeat(40), { kind: "remote", name: "origin" }, 5)).rejects.toBeInstanceOf(AgentError);
  });
});


describe("repository identity", () => {
  it("rootCommits: empty repo gives none; several roots (an orphan branch) give all, once", async () => {
    expect(await port.rootCommits(repo)).toEqual([]);
    const first = commit(repo, { "a.txt": "1\n" });
    expect(await port.rootCommits(repo)).toEqual([first]);
    git(repo, ["checkout", "-q", "--orphan", "other"]);
    const second = commit(repo, { "b.txt": "2\n" });
    git(repo, ["checkout", "-q", "main"]);
    expect([...(await port.rootCommits(repo))].sort()).toEqual([first, second].sort());
  });

  it("rootCommits ignores replace refs, so a grafted fake parent cannot hide the real first commit", async () => {
    const first = commit(repo, { "a.txt": "1\n" });
    commit(repo, { "b.txt": "2\n" });
    const fakeParent = git(repo, ["commit-tree", "-m", "fake", "HEAD^{tree}"]);
    git(repo, ["replace", "--graft", first, fakeParent]);
    expect(git(repo, ["rev-list", "--max-parents=0", "HEAD"])).toBe(fakeParent); // what plain git now reports
    expect(await port.rootCommits(repo)).toEqual([first]);
  });

  it("rootCommits: history unreachable from HEAD but present on another branch still counts", async () => {
    git(repo, ["checkout", "-q", "--orphan", "x"]);
    const orphan = commit(repo, { "a.txt": "1\n" });
    git(repo, ["checkout", "-q", "--orphan", "y"]);
    commit(repo, { "b.txt": "2\n" });
    expect(await port.rootCommits(repo)).toContain(orphan);
  });

  it("remoteUrls: none without remotes; fetch and push URLs of every remote, once each", async () => {
    expect(await port.remoteUrls(repo)).toEqual([]);
    git(repo, ["remote", "add", "origin", "git@github.com:acme/portal.git"]);
    git(repo, ["remote", "add", "fork", "https://github.com/me/fork.git"]);
    git(repo, ["remote", "set-url", "--push", "origin", "git@github.com:me/elsewhere.git"]);
    git(repo, ["remote", "set-url", "--add", "fork", "https://gitlab.com/me/second.git"]);
    expect([...(await port.remoteUrls(repo))].sort()).toEqual(
      ["git@github.com:acme/portal.git", "git@github.com:me/elsewhere.git", "https://github.com/me/fork.git", "https://gitlab.com/me/second.git"].sort(),
    );
  });

  it("remoteUrls applies insteadOf rewriting", async () => {
    git(repo, ["remote", "add", "origin", "corp:acme/portal.git"]);
    git(repo, ["config", "url.git@github.com:.insteadOf", "corp:"]);
    expect(await port.remoteUrls(repo)).toEqual(["git@github.com:acme/portal.git"]);
  });

  it("remoteUrls: a remote named like an option is handled as a name", async () => {
    git(repo, ["remote", "add", "--", "-weird", "https://github.com/me/x.git"]);
    expect(await port.remoteUrls(repo)).toEqual(["https://github.com/me/x.git"]);
  });

  it("outside a repository both throw instead of answering 'nothing'", async () => {
    mkdirSync(join(root, "plain"));
    await expect(port.rootCommits(join(root, "plain"))).rejects.toBeInstanceOf(AgentError);
    await expect(port.remoteUrls(join(root, "plain"))).rejects.toBeInstanceOf(AgentError);
  });
});
