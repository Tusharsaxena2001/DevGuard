import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProject } from "@devguard/shared";
import { createFsConfigStore } from "../../src/adapters/fs-store/fs-config-store.js";
import { UNAPPROVED, secret, World } from "./world.js";

let w: World;
beforeEach(() => void (w = new World()));
afterEach(() => w.cleanup());

/** A project that matches nothing by itself (a corp host the repo never uses) until a test adds an identity. */
const aProject = (projectId: string, change: (p: AgentProject) => void = () => undefined): AgentProject => {
  const p: AgentProject = {
    projectId,
    name: `Project ${projectId}`,
    policy: {
      version: 1,
      mode: "enforce",
      classification: "confidential",
      destinations: [{ host: "git.corp.example", repoPath: `corp/${projectId}`, type: "exact" }],
      prohibitedGlobs: [".env"],
      secretRules: ["github_token"],
    },
    canonicalRepos: [{ host: "git.corp.example", repoPath: `corp/${projectId}` }],
    fingerprints: [],
  };
  change(p);
  return p;
};

async function cache(...projects: AgentProject[]): Promise<void> {
  const store = createFsConfigStore(w.state);
  for (const project of projects) await store.writePolicy({ fetchedAt: "2026-06-01T12:00:00.000Z", project });
}

const rootSha = (): string => w.gitOk(["rev-list", "--max-parents=0", "HEAD"]);
const install = (): void => void expect(w.devguard(["install", "--global"]).status).toBe(0);

describe("automatic matching through the real hook (no registration)", () => {
  it("fingerprint: a repo rewired to a personal remote is still protected", async () => {
    w.commit({ "a.txt": "1\n" });
    await cache(aProject("p1", (p) => void (p.fingerprints = [rootSha()])));
    install();
    const bare = w.addRemote("fork", UNAPPROVED);
    w.gitOk(["remote", "remove", "origin"]);
    w.commit({ "b.txt": "2\n" });
    w.expectBlocked(w.git(["push", "fork", "HEAD:refs/heads/main"]), "github.com/personal/fork");
    expect(w.refsOf(bare)).toBe("");
    expect(w.events().at(-1)).toMatchObject({ projectId: "p1" });
    expect(w.devguard(["status"]).stdout).toContain("recognised by its first commit");
  });

  it("a push by URL alone (no remote configured) to a project's canonical repo is recognised and checked", async () => {
    w.commit({ "a.txt": "1\n" });
    const portal = { host: "github.com", repoPath: "acme/portal" };
    await cache(aProject("p1", (p) => void ((p.canonicalRepos = [portal]), (p.policy.destinations = [{ ...portal, type: "exact" }]))));
    install();
    w.gitOk(["remote", "remove", "origin"]);
    w.commit({ "k.txt": `t=${secret()}\n` });
    w.expectBlocked(w.git(["push", "git@github.com:acme/portal.git", "HEAD:refs/heads/main"]), "possible secret");
  });

  it("a moved repository is still recognised by its first commit", async () => {
    w.commit({ "a.txt": "1\n" });
    await cache(aProject("p1", (p) => void (p.fingerprints = [rootSha()])));
    const moved = join(w.dir, "moved");
    w.run("mv", [w.repo, moved], w.dir);
    expect(w.devguard(["status"], moved).stdout).toContain("recognised by its first commit");
  });

  it("remote: a repo whose remote is the project's canonical repo is protected", async () => {
    w.commit({ "a.txt": "1\n" });
    const portal = { host: "github.com", repoPath: "acme/portal" };
    await cache(
      aProject("p1", (p) => {
        p.canonicalRepos = [portal];
        p.policy.destinations = [{ ...portal, type: "exact" }];
      }),
    );
    install();
    expect(w.devguard(["status"]).stdout).toContain("recognised by its remote");
    w.commit({ "k.txt": `t=${secret()}\n` });
    w.expectBlocked(w.git(["push", "origin", "HEAD:refs/heads/main"]), "possible secret");
  });

  it("a repo that matches no project is allowed silently, even to a personal destination (ADR-003)", async () => {
    w.commit({ "a.txt": "1\n" });
    await cache(aProject("p1", (p) => void (p.fingerprints = ["f".repeat(40)])));
    install();
    const bare = w.addRemote("fork", UNAPPROVED);
    w.commit({ "k.txt": `t=${secret()}\n` });
    const push = w.git(["push", "fork", "HEAD:refs/heads/main"]);
    expect(push.status).toBe(0);
    expect(push.stderr).not.toContain("DevGuard");
    expect(w.refsOf(bare)).not.toBe("");
    expect(w.events()).toEqual([]);
  });

  it("an empty repository with nothing to match is allowed and cannot crash the hook", async () => {
    await cache(aProject("p1", (p) => void (p.fingerprints = ["f".repeat(40)])));
    install();
    const status = w.devguard(["status", "--json"]);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ repository: { state: "unprotected" } });
  });

  it("several matching projects: the strictest governs", async () => {
    w.commit({ "a.txt": "1\n" });
    const root = rootSha();
    await cache(
      aProject("lenient", (p) => {
        p.fingerprints = [root];
        p.policy.mode = "audit_only";
      }),
      aProject("strict", (p) => void (p.fingerprints = [root])),
    );
    install();
    w.addRemote("fork", UNAPPROVED);
    w.commit({ "b.txt": "2\n" });
    w.expectBlocked(w.git(["push", "fork", "HEAD:refs/heads/main"]));
    expect(w.events().at(-1)).toMatchObject({ projectId: "strict" });
    expect(w.devguard(["status"]).stdout).toContain("also matches 1 other project");
  });

  it("a permissive decoy project cannot override a stricter one the repo also matches", async () => {
    w.commit({ "a.txt": "1\n" });
    const root = rootSha();
    const personal = { host: "github.com", repoPath: "personal/fork" };
    await cache(
      aProject("real", (p) => void (p.fingerprints = [root])),
      aProject("0000", (p) => {
        p.fingerprints = [root];
        p.policy.classification = "confidential";
        p.policy.secretRules = [];
        p.policy.prohibitedGlobs = [];
        p.policy.destinations = [{ ...personal, type: "exact" }];
      }),
    );
    install();
    const bare = w.addRemote("fork", UNAPPROVED);
    w.commit({ "k.txt": `t=${secret()}\n` });
    w.expectBlocked(w.git(["push", "fork", "HEAD:refs/heads/main"]));
    expect(w.refsOf(bare)).toBe("");
    expect(w.events().at(-1)).toMatchObject({ projectId: "real" });
  });

  it("a corrupt cached policy for an unrelated project blocks every push (fails closed) and status says so", async () => {
    w.commit({ "a.txt": "1\n" });
    await cache(aProject("p1"));
    writeFileSync(join(w.state, "policies", "junk.json"), "{not json", { mode: 0o600 });
    install();
    const push = w.git(["push", "origin", "HEAD:refs/heads/main"]);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("could not check");
    const status = w.devguard(["status"]);
    expect(status.stdout).toContain("PROTECTION UNKNOWN");
    expect(status.status).toBe(2);
  });
});

describe("manual register / unregister (local mode, no server)", () => {
  const policyFile = (project: AgentProject): string => {
    const file = join(w.dir, "policy.json");
    writeFileSync(file, JSON.stringify(project));
    return file;
  };

  it("round trip: register with a policy file protects the repo, unregister releases it", async () => {
    w.commit({ "a.txt": "1\n" });
    install();
    w.addRemote("fork", UNAPPROVED);
    w.commit({ "b.txt": "2\n" });
    expect(w.git(["push", "fork", "HEAD:refs/heads/main"]).status).toBe(0);

    const reg = w.devguard(["register", "--policy-file", policyFile(aProject("p1"))]);
    expect(reg.status).toBe(0);
    expect(reg.stdout).toContain("Registered");
    expect(reg.stdout).toContain("not verified by a server");
    expect(w.devguard(["status"]).stdout).toContain("protected by Project p1 (enforce), recognised by manual registration");

    w.commit({ "c.txt": "3\n" });
    w.expectBlocked(w.git(["push", "fork", "HEAD:refs/heads/main"]), "github.com/personal/fork");

    const again = w.devguard(["register", "--project", "p1"]);
    expect(again.stdout).toContain("already registered");
    expect(w.devguard(["unregister"]).stdout).toContain("Removed the manual registration");
    expect(w.git(["push", "fork", "HEAD:refs/heads/main"]).status).toBe(0);
    expect(w.devguard(["unregister"]).stdout).toContain("had no manual registration");
  });

  it("registers by project id once the policy is cached, and refuses an unknown project", async () => {
    w.commit({ "a.txt": "1\n" });
    expect(w.devguard(["register", "--project", "ghost"])).toMatchObject({ status: 2 });
    expect(w.devguard(["register", "--project", "ghost"]).stderr).toContain("no policy for that project");
    await cache(aProject("p1"));
    expect(w.devguard(["register", "--project", "p1"]).status).toBe(0);
    expect(w.devguard(["register"]).stderr).toContain("Say which project");
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["wrong shape", JSON.stringify({ projectId: "p1" })],
    ["unsafe project id", JSON.stringify(aProject("../evil"))],
    ["unknown policy field", JSON.stringify({ ...aProject("p1"), extra: 1 })],
  ])("rejects a policy file with %s and registers nothing", (_n, content) => {
    w.commit({ "a.txt": "1\n" });
    const file = join(w.dir, "bad.json");
    writeFileSync(file, content);
    const out = w.devguard(["register", "--policy-file", file]);
    expect(out.status).toBe(2);
    expect(out.stderr).not.toBe("");
    const status = JSON.parse(w.devguard(["status", "--json"]).stdout) as { registeredRepoCount: number; policies: unknown[] };
    expect(status.registeredRepoCount).toBe(0);
    expect(status.policies).toEqual([]);
  });

  it("refuses a missing policy file, a mismatched --project, and a non-repository", () => {
    w.commit({ "a.txt": "1\n" });
    expect(w.devguard(["register", "--policy-file", join(w.dir, "absent.json")]).status).toBe(2);
    expect(w.devguard(["register", "--project", "other", "--policy-file", policyFile(aProject("p1"))]).stderr).toContain("does not match");
    expect(w.devguard(["register", w.dir, "--project", "p1"], w.dir).stderr).toContain("not inside a Git repository");
  });

  it("from a linked worktree: registers the main checkout, protects both, and unregister releases both", async () => {
    w.commit({ "a.txt": "1\n" });
    install();
    const wt = join(w.dir, "wt");
    w.gitOk(["worktree", "add", "-q", wt, "-b", "feature"]);
    const reg = w.devguard(["register", "--policy-file", policyFile(aProject("p1"))], wt);
    expect(reg.stdout).toContain(w.repo);
    w.addRemote("fork", UNAPPROVED);
    for (const dir of [w.repo, wt]) {
      expect(w.devguard(["status"], dir).stdout).toContain("recognised by manual registration");
    }
    w.expectBlocked(w.git(["push", "fork", "HEAD:refs/heads/main"], wt));
    expect(w.devguard(["unregister"], wt).stdout).toContain("Removed");
    for (const dir of [w.repo, wt]) expect(w.devguard(["status"], dir).stdout).toContain("not protected");
  });

  it("a different policy for a known project is refused until --replace-policy is given", async () => {
    w.commit({ "a.txt": "1\n" });
    await cache(aProject("p1"));
    const weaker = aProject("p1", (p) => void (p.policy.mode = "audit_only"));
    const refused = w.devguard(["register", "--policy-file", policyFile(weaker)]);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("--replace-policy");
    expect(w.devguard(["register", "--replace-policy", "--policy-file", policyFile(weaker)]).status).toBe(0);
  });

  it("a corrupt repos.json makes status exit 2 and blocks the push (state unusable)", async () => {
    w.commit({ "a.txt": "1\n" });
    await cache(aProject("p1"));
    writeFileSync(join(w.state, "repos.json"), "{bad", { mode: 0o600 });
    install();
    expect(w.devguard(["status"]).status).toBe(2);
    expect(w.git(["push", "origin", "HEAD:refs/heads/main"]).status).not.toBe(0);
  });

  it("a symlinked path registers the real repository and the hook still recognises it", async () => {
    w.commit({ "a.txt": "1\n" });
    install();
    const link = join(w.dir, "link");
    symlinkSync(w.repo, link);
    expect(w.devguard(["register", link, "--policy-file", policyFile(aProject("p1"))], w.dir).status).toBe(0);
    w.addRemote("fork", UNAPPROVED);
    w.commit({ "b.txt": "2\n" });
    w.expectBlocked(w.git(["push", "fork", "HEAD:refs/heads/main"]));
    // And pushing from inside the symlinked path (cwd is the link) resolves to the same repository.
    const viaLink = w.git(["push", "fork", "HEAD:refs/heads/main"], link);
    expect(viaLink.status).not.toBe(0);
    expect(viaLink.stderr).toContain("DevGuard blocked this push.");
  });

  it("a repository moved after registration is no longer matched by its old path", async () => {
    w.commit({ "a.txt": "1\n" });
    expect(w.devguard(["register", "--policy-file", policyFile(aProject("p1"))]).status).toBe(0);
    const moved = join(w.dir, "moved");
    mkdirSync(join(w.dir, "work"), { recursive: true });
    w.run("mv", [w.repo, moved], w.dir);
    expect(w.devguard(["status"], moved).stdout).toContain("not protected");
  });
});
