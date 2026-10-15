import { describe, expect, it } from "vitest";
import type { AgentProject } from "@devguard/shared";
import { AgentError } from "../errors.js";
import type { ConfigStore, StoreRead } from "../ports/config-store.js";
import type { CachedPolicy, RegisteredRepos } from "../ports/local-state.js";
import { fail, ok } from "../result.js";
import { cachedPolicy, fakeGit, fakeStore, fixedClock, project } from "../../test/support/fakes.js";
import { registerRepo, unregisterRepo, type RegisterDeps } from "./register-repo.js";

interface Harness {
  deps: RegisterDeps;
  writes: { repos: RegisteredRepos[]; policies: CachedPolicy[] };
}

function harness(opts: { repos?: StoreRead<RegisteredRepos>; policies?: Record<string, StoreRead<CachedPolicy>>; file?: unknown; fileFails?: boolean; git?: Parameters<typeof fakeGit>[0] } = {}): Harness {
  const writes: Harness["writes"] = { repos: [], policies: [] };
  const base = fakeStore({ repos: opts.repos ?? ok(undefined) }, opts.policies ?? {});
  const store: ConfigStore = { ...base, writeRepos: async (r) => void writes.repos.push(r), writePolicy: async (p) => void writes.policies.push(p) };
  return {
    writes,
    deps: {
      store,
      git: fakeGit(opts.git ?? { repoRoot: "/repo" }),
      clock: fixedClock(),
      policyFile: { read: async () => (opts.fileFails ? fail("unreadable") : ok(opts.file)) },
    },
  };
}

const rejection = async (p: Promise<unknown>): Promise<AgentError> => {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(AgentError);
  return e as AgentError;
};
const entry = (repoPath: string, projectId: string): RegisteredRepos["repos"][number] => ({ repoPath, projectId, registeredAt: "2026-06-01T12:00:00.000Z" });

describe("registerRepo", () => {
  it("registers a repo to an already cached project without touching the policy", async () => {
    const h = harness({ policies: { "proj-1": ok(cachedPolicy("proj-1")) } });
    const r = await registerRepo(h.deps, { path: "/repo", projectId: "proj-1" });
    expect(r).toMatchObject({ repoPath: "/repo", projectId: "proj-1", policyCached: false, alreadyRegistered: false });
    expect(h.writes.policies).toEqual([]);
    expect(h.writes.repos).toEqual([{ repos: [entry("/repo", "proj-1")].map((e) => ({ ...e, registeredAt: "2026-06-01T12:00:00.000Z" })) }]);
  });

  it("is idempotent: registering again writes nothing", async () => {
    const h = harness({ repos: ok({ repos: [entry("/repo", "proj-1")] }), policies: { "proj-1": ok(cachedPolicy("proj-1")) } });
    expect(await registerRepo(h.deps, { path: "/repo", projectId: "proj-1" })).toMatchObject({ alreadyRegistered: true });
    expect(h.writes).toEqual({ repos: [], policies: [] });
  });

  it("the same repo may belong to two projects; other repos' entries are kept", async () => {
    const h = harness({ repos: ok({ repos: [entry("/repo", "a"), entry("/other", "a")] }), policies: { b: ok(cachedPolicy("b")) } });
    await registerRepo(h.deps, { path: "/repo", projectId: "b" });
    expect(h.writes.repos[0]?.repos.map((r) => `${r.repoPath}:${r.projectId}`)).toEqual(["/repo:a", "/other:a", "/repo:b"]);
  });

  it("registers the main checkout when started from a linked worktree", async () => {
    const h = harness({ policies: { "proj-1": ok(cachedPolicy("proj-1")) }, git: { repoRoot: "/wt", mainRoot: "/main" } });
    expect((await registerRepo(h.deps, { path: "/wt", projectId: "proj-1" })).repoPath).toBe("/main");
  });

  it("a policy file registers and caches its project; a matching --project is accepted", async () => {
    const h = harness({ file: project("proj-9") });
    const r = await registerRepo(h.deps, { path: "/repo", projectId: "proj-9", policyFile: "p.json" });
    expect(r).toMatchObject({ projectId: "proj-9", policyCached: true });
    expect(h.writes.policies).toEqual([{ fetchedAt: "2026-06-01T12:00:00.000Z", project: project("proj-9") }]);
  });

  it.each([
    ["not in a repository", { path: "/x", projectId: "p" }, { repoRoot: undefined }, "not inside a Git repository"],
    ["no project and no file", { path: "/repo" }, {}, "Say which project"],
    ["unsafe project id", { path: "/repo", projectId: "../x" }, {}, "letters, digits"],
    ["unknown project", { path: "/repo", projectId: "ghost" }, {}, "no policy for that project"],
  ] as const)("refuses %s", async (_n, request, git, message) => {
    const h = harness({ git });
    expect((await rejection(registerRepo(h.deps, request))).message).toContain(message);
    expect(h.writes).toEqual({ repos: [], policies: [] });
  });

  it.each([
    ["unreadable file", { fileFails: true }, "could not be used"],
    ["null", { file: null }, "not a valid DevGuard project policy"],
    ["array", { file: [] }, "not a valid DevGuard project policy"],
    ["extra field", { file: { ...project("p"), extra: 1 } }, "not a valid DevGuard project policy"],
    ["unsafe id inside the file", { file: project("../evil") }, "letters, digits"],
    ["mismatched --project", { file: project("p") }, "does not match"],
  ] as const)("refuses a policy file: %s, writing nothing", async (_n, opts, message) => {
    const h = harness(opts);
    const e = await rejection(registerRepo(h.deps, { path: "/repo", policyFile: "p.json", ...(message === "does not match" ? { projectId: "q" } : {}) }));
    expect(e.message).toContain(message);
    expect(h.writes).toEqual({ repos: [], policies: [] });
  });

  it("an unreadable repos file fails before the policy is cached", async () => {
    const h = harness({ repos: fail("invalid"), file: project("p") });
    expect((await rejection(registerRepo(h.deps, { path: "/repo", policyFile: "p.json" }))).code).toBe("config_invalid");
    expect(h.writes).toEqual({ repos: [], policies: [] });
  });

  it("an unreadable cached policy is a state error, not 'no policy'", async () => {
    const h = harness({ policies: { p: fail("insecure_permissions") } });
    expect((await rejection(registerRepo(h.deps, { path: "/repo", projectId: "p" }))).code).toBe("config_invalid");
  });

  describe("an existing cached policy is not silently replaced", () => {
    const weaker = (): AgentProject => {
      const p = project("proj-1");
      p.policy.mode = "audit_only";
      p.policy.prohibitedGlobs = [];
      return p;
    };
    it("a different policy for a known project is refused without --replace-policy", async () => {
      const h = harness({ policies: { "proj-1": ok(cachedPolicy("proj-1")) }, file: weaker() });
      expect((await rejection(registerRepo(h.deps, { path: "/repo", policyFile: "p.json" }))).message).toContain("--replace-policy");
      expect(h.writes).toEqual({ repos: [], policies: [] });
    });
    it("an identical policy is accepted, and --replace-policy replaces", async () => {
      const same = harness({ policies: { "proj-1": ok(cachedPolicy("proj-1")) }, file: project("proj-1") });
      await expect(registerRepo(same.deps, { path: "/repo", policyFile: "p.json" })).resolves.toBeDefined();
      const replace = harness({ policies: { "proj-1": ok(cachedPolicy("proj-1")) }, file: weaker() });
      await registerRepo(replace.deps, { path: "/repo", policyFile: "p.json", replacePolicy: true });
      expect(replace.writes.policies[0]?.project.policy.mode).toBe("audit_only");
    });
  });
});

describe("unregisterRepo", () => {
  it("removes every project's entry for exactly that repo and keeps the rest", async () => {
    const h = harness({ repos: ok({ repos: [entry("/repo", "a"), entry("/repo", "b"), entry("/repo2", "a"), entry("/rep", "a")] }) });
    expect(await unregisterRepo(h.deps, "/repo")).toEqual({ repoPath: "/repo", removed: 2 });
    expect(h.writes.repos[0]?.repos.map((r) => r.repoPath)).toEqual(["/repo2", "/rep"]);
  });
  it("writes nothing when there was nothing to remove", async () => {
    const h = harness({ repos: ok({ repos: [entry("/other", "a")] }) });
    expect(await unregisterRepo(h.deps, "/repo")).toMatchObject({ removed: 0 });
    expect(h.writes.repos).toEqual([]);
  });
  it("an unreadable repos file is an error and nothing is written", async () => {
    const h = harness({ repos: fail("insecure_permissions") });
    expect((await rejection(unregisterRepo(h.deps, "/repo"))).code).toBe("config_invalid");
    expect(h.writes.repos).toEqual([]);
  });
});
