import { describe, expect, it } from "vitest";
import type { AgentProject } from "@devguard/shared";
import type { ConfigStore, StoreRead } from "../ports/config-store.js";
import type { CachedPolicy, RegisteredRepos } from "../ports/local-state.js";
import { fail, ok } from "../result.js";
import { cachedPolicy, fakeGit, fakeStore, type GitScript } from "../../test/support/fakes.js";
import { resolveRepo } from "./resolve-repo.js";

const sha = (c: string): string => c.repeat(40);
const entry = (repoPath: string, projectId: string): RegisteredRepos["repos"][number] => ({ repoPath, projectId, registeredAt: "2026-06-01T12:00:00.000Z" });

/** A cached project that, by default, matches nothing (no fingerprint, remote or destination of its own). */
function cached(projectId: string, change: (p: AgentProject) => void = () => undefined): CachedPolicy {
  const c = cachedPolicy(projectId);
  c.project.fingerprints = [];
  c.project.canonicalRepos = [{ host: "git.corp.example", repoPath: `corp/${projectId}` }];
  c.project.policy.destinations = [{ host: "git.corp.example", repoPath: `corp/${projectId}`, type: "exact" }];
  change(c.project);
  return c;
}

function run(opts: { repos?: StoreRead<RegisteredRepos>; policies?: Record<string, StoreRead<CachedPolicy>>; git?: GitScript; store?: ConfigStore; roots?: string[]; pushUrl?: string }) {
  const store = opts.store ?? fakeStore({ repos: opts.repos ?? ok(undefined) }, opts.policies ?? {});
  return resolveRepo({ store, git: fakeGit(opts.git) }, { cwd: "/repo", repoRoots: opts.roots ?? ["/repo"], ...(opts.pushUrl === undefined ? {} : { pushUrl: opts.pushUrl }) });
}

const governing = async (p: ReturnType<typeof run>): Promise<string | undefined> => {
  const r = await p;
  return r.ok && r.value.matched ? r.value.project.projectId : undefined;
};

describe("resolveRepo: no match", () => {
  it("is unprotected when nothing matches (ADR-003)", async () => {
    expect(await run({ policies: { a: ok(cached("a")) }, git: { roots: [sha("1")], remotes: ["git@github.com:me/personal.git"] } })).toEqual({ ok: true, value: { matched: false } });
  });
  it("is unprotected with no projects at all, without asking git anything", async () => {
    const git = fakeGit({ failing: [{ method: "rootCommits" }, { method: "remoteUrls" }] });
    expect(await resolveRepo({ store: fakeStore(), git }, { cwd: "/repo", repoRoots: ["/repo"] })).toEqual({ ok: true, value: { matched: false } });
  });
  it("an empty repo (no root commits) can still match by remote", async () => {
    const p = cached("a", (x) => void (x.fingerprints = [sha("1")]));
    expect(await run({ policies: { a: ok(p) }, git: { roots: [], remotes: ["git@git.corp.example:corp/a.git"] } })).toMatchObject({ ok: true, value: { matched: true, via: "remote" } });
    expect(await run({ policies: { a: ok(p) }, git: { roots: [], remotes: [] } })).toEqual({ ok: true, value: { matched: false } });
  });
});

describe("resolveRepo: fingerprint", () => {
  const p = cached("a", (x) => void (x.fingerprints = [sha("1")]));
  it("matches when any root commit equals a project fingerprint, even if every remote is a personal one", async () => {
    const r = await run({ policies: { a: ok(p) }, git: { roots: [sha("9"), sha("1")], remotes: ["git@github.com:me/personal.git"] } });
    expect(r).toMatchObject({ ok: true, value: { matched: true, via: "fingerprint", matches: [{ projectId: "a", via: "fingerprint" }] } });
  });
  it("does not match a different root, nor a prefix of it", async () => {
    expect(await run({ policies: { a: ok(p) }, git: { roots: [sha("2"), `${"1".repeat(39)}2`] } })).toEqual({ ok: true, value: { matched: false } });
  });
});

describe("resolveRepo: remote", () => {
  const p = cached("a");
  it.each([
    ["scp-style", "git@git.corp.example:corp/a.git"],
    ["https with .git and mixed case", "https://Git.Corp.Example/corp/a.git"],
    ["ssh url", "ssh://git@git.corp.example/corp/a"],
  ])("matches a configured remote written as %s", async (_n, url) => {
    expect(await governing(run({ policies: { a: ok(p) }, git: { remotes: ["git@github.com:me/x.git", url] } }))).toBe("a");
  });
  it("matches the URL being pushed even when it is not a configured remote", async () => {
    expect(await governing(run({ policies: { a: ok(p) }, pushUrl: "git@git.corp.example:corp/a.git" }))).toBe("a");
  });
  it.each([
    ["lookalike host", "git@git.corp.example.evil.io:corp/a.git"],
    ["repo prefix", "git@git.corp.example:corp/a-fork.git"],
    ["other owner", "git@git.corp.example:other/a.git"],
    ["unparsable", "not a url at all"],
    ["empty", ""],
  ])("does not match %s", async (_n, url) => {
    expect(await governing(run({ policies: { a: ok(p) }, git: { remotes: [url] } }))).toBeUndefined();
  });
  it("an owner wildcard destination does not make every repo of that owner a match", async () => {
    const w = cached("w", (x) => {
      x.canonicalRepos = [];
      x.policy.destinations = [{ host: "git.corp.example", repoPath: "corp", type: "owner_wildcard" }];
    });
    expect(await governing(run({ policies: { w: ok(w) }, git: { remotes: ["git@git.corp.example:corp/anything.git"] } }))).toBeUndefined();
  });
  it("an exact approved destination identifies the repo even when it is not listed as canonical", async () => {
    const e = cached("e", (x) => void (x.canonicalRepos = []));
    expect(await governing(run({ policies: { e: ok(e) }, git: { remotes: ["git@git.corp.example:corp/e.git"] } }))).toBe("e");
  });
});

describe("resolveRepo: manual", () => {
  const p = cached("a");
  it("a registered repo resolves to its cached project", async () => {
    const r = await run({ repos: ok({ repos: [entry("/repo", "a")] }), policies: { a: ok(p) } });
    expect(r).toMatchObject({ ok: true, value: { matched: true, via: "manual", project: p.project, fetchedAt: p.fetchedAt, matches: [{ projectId: "a", via: "manual" }], projects: [{ project: p.project, via: "manual" }] } });
  });
  it("matches the root exactly, not by prefix", async () => {
    expect(await run({ repos: ok({ repos: [entry("/repo", "a")] }), policies: { a: ok(p) }, roots: ["/repo/sub"] })).toEqual({ ok: true, value: { matched: false } });
    expect(await run({ repos: ok({ repos: [entry("/repo-other", "a")] }), policies: { a: ok(p) } })).toEqual({ ok: true, value: { matched: false } });
  });
  it("a linked worktree is recognised through the main checkout that was registered", async () => {
    const opts = { repos: ok({ repos: [entry("/main", "a")] }), policies: { a: ok(p) } };
    expect(await run({ ...opts, roots: ["/worktrees/feature"] })).toEqual({ ok: true, value: { matched: false } });
    expect(await governing(run({ ...opts, roots: ["/worktrees/feature", "/main"] }))).toBe("a");
  });
  it("a registration whose policy is missing is policy_unusable (ADR-004)", async () => {
    expect(await run({ repos: ok({ repos: [entry("/repo", "a")] }) })).toEqual({ ok: false, reason: "policy_unusable" });
  });
});

describe("resolveRepo: fails closed when it cannot tell", () => {
  it.each(["invalid", "insecure_permissions", "unreadable"] as const)("unusable repos file (%s) is state_unusable", async (reason) => {
    expect(await run({ repos: fail(reason) })).toEqual({ ok: false, reason: "state_unusable" });
  });
  it("an unlistable policy cache is state_unusable", async () => {
    expect(await run({ store: fakeStore({ policyList: fail("insecure_permissions") }) })).toEqual({ ok: false, reason: "state_unusable" });
  });
  it.each(["invalid", "insecure_permissions", "unreadable"] as const)("any unusable cached policy (%s) is policy_unusable, even one that would not have matched", async (reason) => {
    expect(await run({ policies: { good: ok(cached("good")), bad: fail(reason) } })).toEqual({ ok: false, reason: "policy_unusable" });
  });
  it("a policy file listed but vanished is policy_unusable", async () => {
    expect(await run({ store: fakeStore({ policyList: ok(["ghost"]) }) })).toEqual({ ok: false, reason: "policy_unusable" });
  });
  it("a git failure while reading facts propagates (the hook turns it into a block)", async () => {
    await expect(run({ policies: { a: ok(cached("a")) }, git: { failing: [{ method: "rootCommits" }] } })).rejects.toThrow();
    await expect(run({ policies: { a: ok(cached("a")) }, git: { failing: [{ method: "remoteUrls" }] } })).rejects.toThrow();
  });
});

describe("resolveRepo: several matches", () => {
  const remotes = ["git@git.corp.example:corp/x.git", "git@git.corp.example:corp/y.git", "git@git.corp.example:corp/z.git"];
  const mk = (id: string, mode: "enforce" | "audit_only", classification: "internal" | "confidential" | "client_owned"): CachedPolicy =>
    cached(id, (p) => {
      p.policy.mode = mode;
      p.policy.classification = classification;
    });

  it("enforce beats audit-only, then stricter classification, then project id, in any order", async () => {
    const all = { x: mk("x", "audit_only", "client_owned"), y: mk("y", "enforce", "internal"), z: mk("z", "enforce", "confidential") };
    const orders = [["x", "y", "z"], ["z", "y", "x"], ["y", "x", "z"]] as const;
    for (const order of orders) {
      const policies = Object.fromEntries(order.map((id) => [id, ok(all[id])]));
      const r = await run({ policies, git: { remotes } });
      expect(r).toMatchObject({ ok: true, value: { matched: true, project: { projectId: "z" }, matches: [{ projectId: "z" }, { projectId: "y" }, { projectId: "x" }] } });
    }
  });
  it("equal restrictiveness is broken by project id so the result is deterministic", async () => {
    const policies = { y: ok(mk("y", "enforce", "internal")), x: ok(mk("x", "enforce", "internal")) };
    expect(await governing(run({ policies, git: { remotes } }))).toBe("x");
  });
  it("client_owned outranks confidential, which outranks internal (equal mode)", async () => {
    const policies = { x: ok(mk("x", "enforce", "internal")), y: ok(mk("y", "enforce", "confidential")), z: ok(mk("z", "enforce", "client_owned")) };
    const r = await run({ policies, git: { remotes } });
    expect(r).toMatchObject({ ok: true, value: { project: { projectId: "z" }, fetchedAt: policies.z.value.fetchedAt, matches: [{ projectId: "z" }, { projectId: "y" }, { projectId: "x" }] } });
  });
  it("reports how each project matched; the strongest signal wins per project", async () => {
    const a = cached("a", (p) => {
      p.fingerprints = [sha("1")];
    });
    const r = await run({ repos: ok({ repos: [entry("/repo", "a")] }), policies: { a: ok(a) }, git: { roots: [sha("1")], remotes: ["git@git.corp.example:corp/a.git"] } });
    expect(r).toMatchObject({ ok: true, value: { via: "fingerprint", matches: [{ projectId: "a", via: "fingerprint" }] } });
  });
});

describe("resolveRepo: via priority and duplicates", () => {
  const remote = ["git@git.corp.example:corp/a.git"];
  it.each<[string, Omit<Parameters<typeof run>[0], "policies">, string]>([
    ["remote + manual", { repos: ok({ repos: [entry("/repo", "a")] }), git: { remotes: remote } }, "remote"],
    ["fingerprint + manual", { repos: ok({ repos: [entry("/repo", "a")] }), git: { roots: [sha("1")] } }, "fingerprint"],
    ["fingerprint + remote", { git: { roots: [sha("1")], remotes: remote } }, "fingerprint"],
  ] as const)("%s reports %s", async (_n, opts, via) => {
    const r = await run({ ...opts, policies: { a: ok(cached("a", (p) => void (p.fingerprints = [sha("1")]))) } });
    expect(r).toMatchObject({ ok: true, value: { via } });
  });
  it("two cached files claiming one project id fail closed", async () => {
    const dup = fakeStore({ policyList: ok(["one", "two"]) }, { one: ok(cached("same")), two: ok(cached("same")) });
    expect(await run({ store: dup })).toEqual({ ok: false, reason: "policy_unusable" });
  });
  it("a git failure is an error the caller turns into a block (not an 'unprotected' answer)", async () => {
    const e = await run({ policies: { a: ok(cached("a")) }, git: { failing: [{ method: "rootCommits" }] } }).then(() => undefined, (x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toContain("fake git failure in rootCommits");
  });
});
