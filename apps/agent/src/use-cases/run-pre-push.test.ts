import { describe, expect, it } from "vitest";
import { SecurityEventInputSchema, type RefUpdate, type ValidException } from "@devguard/shared";
import { fail, ok } from "../result.js";
import { cachedPolicy, fakeGit, fakeStore, fixedClock, memoryEvents, sequentialIds, type GitScript } from "../../test/support/fakes.js";
import type { StoreRead } from "../ports/config-store.js";
import type { CachedPolicy, RegisteredRepos } from "../ports/local-state.js";
import { runPrePush, type PrePushDeps } from "./run-pre-push.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C1 = "1".repeat(40);
const ZERO = "0".repeat(40);
const OK_URL = "git@github.com:acme/portal.git";
const OTHER_URL = "git@github.com:personal/fork.git";

const secret = (): string => "gh" + "p_" + "Q".repeat(36);
const stdin = (...refs: [string, string, string, string][]): string => refs.map((r) => r.join(" ")).join("\n") + "\n";
const update = stdin(["refs/heads/main", A, "refs/heads/main", B]);

interface World {
  policy?: (p: CachedPolicy) => void;
  git?: GitScript;
  registered?: boolean;
  policyRead?: StoreRead<CachedPolicy>;
  reposRead?: StoreRead<RegisteredRepos>;
  eventsFail?: Error;
  deps?: Partial<PrePushDeps>;
  now?: string;
}

function world(w: World = {}) {
  const policy = cachedPolicy("proj-1");
  w.policy?.(policy);
  const repos = w.reposRead ?? ok({ repos: w.registered === false ? [] : [{ repoPath: "/repo", projectId: "proj-1", registeredAt: "2026-06-01T12:00:00.000Z" }] });
  const store = fakeStore({ repos }, { "proj-1": w.policyRead ?? ok(policy) });
  const events = memoryEvents(w.eventsFail);
  const git = fakeGit({ knownObjects: [B], ancestors: [`${B}>${A}`], commits: { [A]: [C1] }, ...w.git });
  const deps: PrePushDeps = { store, git, events, clock: fixedClock(w.now), newId: sequentialIds("id"), agentVersion: "9.9.9", maxStaleMinutes: 60, ...w.deps };
  const run = (input: string, url = OK_URL) => runPrePush({ remoteName: "origin", remoteUrl: url, stdin: input, cwd: "/repo" }, deps);
  return { run, events, git };
}

describe("unprotected and unknown repositories", () => {
  it("a repo that matches no project is allowed silently with no event (ADR-003) and Git is never queried", async () => {
    const w = world({ registered: false });
    expect(await w.run(update, "garbage")).toEqual({ exitCode: 0, lines: [] });
    expect(w.events.events).toEqual([]);
    expect(w.git.calls).toEqual([]);
  });

  it.each([
    ["unreadable state", { reposRead: fail("insecure_permissions") }, "local state could not be read", "policy_unavailable"],
    ["registered repo without a cached policy", { policyRead: ok(undefined) }, "policy is missing or unusable", "policy_unavailable"],
    ["registered repo with an unusable policy", { policyRead: fail("invalid") }, "policy is missing or unusable", "policy_unavailable"],
    ["not inside a repository", { git: { repoRoot: undefined } }, "not a Git repository", "internal_error"],
  ] as [string, World, string, string][])("blocks when it cannot tell: %s", async (_name, over, text, rule) => {
    const w = world(over);
    const out = await w.run(update);
    expect(out.exitCode).toBe(1);
    expect(out.lines.join("\n")).toContain("could not check it");
    expect(out.lines.join("\n")).toContain(text);
    expect(w.events.events[0]).toMatchObject({ outcome: "error", ruleIds: [rule], projectId: null, wouldBlock: true });
  });

  it.each([["garbage"], ["refs/heads/a aaaa refs/heads/a bbbb\n"], [`refs/heads/a ${A} refs/heads/a ${"b".repeat(64)}\n`]])("blocks on push information it does not understand (%j)", async (input) => {
    const out = await world().run(input);
    expect(out.exitCode).toBe(1);
    expect(out.lines.join("\n")).toContain("does not understand");
  });
});

describe("worktrees, empty pushes and policy age", () => {
  it("a linked worktree of a registered repository is protected through the main checkout", async () => {
    const w = world({ git: { repoRoot: "/worktrees/feature", mainRoot: "/repo" } });
    const out = await w.run(update, OTHER_URL);
    expect(out.exitCode).toBe(1);
    expect(w.events.events[0]).toMatchObject({ projectId: "proj-1", outcome: "blocked" });
  });

  it("a worktree of an unregistered repository stays unprotected", async () => {
    const w = world({ registered: false, git: { repoRoot: "/worktrees/feature", mainRoot: "/main" } });
    expect(await w.run(update, OTHER_URL)).toEqual({ exitCode: 0, lines: [] });
  });

  it("an empty push list is judged by destination alone", async () => {
    expect((await world().run("", OK_URL)).exitCode).toBe(0);
    expect((await world().run("", OTHER_URL)).exitCode).toBe(1);
  });

  it("a locally supplied policy (register --policy-file) never ages: it is still enforced years later", async () => {
    const w = world({ policy: (p) => void (p.fetchedAt = "2016-01-01T00:00:00.000Z") });
    expect((await w.run(update, OTHER_URL)).exitCode).toBe(1);
    expect((await w.run(update)).exitCode).toBe(0);
  });

  it("a pushed ref that is not a commit (e.g. a tag on a blob) blocks in enforce mode", async () => {
    const w = world({ git: { objectTypes: { [A]: "blob" } } });
    const out = await w.run(update);
    expect(out.exitCode).toBe(1);
    expect(out.lines.join("\n")).toContain("could not be fully checked");
  });
});

describe("enforce mode", () => {
  it("allows an approved destination with clean commits, silently, and records the event", async () => {
    const w = world();
    expect(await w.run(update)).toEqual({ exitCode: 0, lines: [] });
    expect(w.events.events).toHaveLength(1);
    expect(w.events.events[0]).toMatchObject({ outcome: "allowed", ruleIds: [], projectId: "proj-1", mode: "enforce", wouldBlock: false, policyVersion: 1, agentVersion: "9.9.9", operation: "push", refs: ["refs/heads/main"], destination: { host: "github.com", repoPath: "acme/portal" } });
  });

  it("accepts the same destination in other URL forms", async () => {
    for (const url of ["https://github.com/acme/portal.git", "ssh://git@github.com/acme/portal", "https://GitHub.com/ACME/Portal"]) {
      expect((await world().run(update, url)).exitCode).toBe(0);
    }
  });

  it("blocks an unapproved destination, naming the project, destination and a next step", async () => {
    const w = world();
    const out = await w.run(update, OTHER_URL);
    expect(out.exitCode).toBe(1);
    const text = out.lines.join("\n");
    expect(text).toContain("DevGuard blocked this push.");
    expect(text).toContain("Project: Portal (confidential, enforce)");
    expect(text).toContain("Destination: github.com/personal/fork");
    expect(text).toContain("not approved");
    expect(text).toContain("Next:");
    expect(text).toContain("Reference: id-00000001");
    expect(w.events.events[0]).toMatchObject({ outcome: "blocked", ruleIds: ["destination_not_approved"], correlationId: "id-00000001" });
  });

  it.each(["not a url", "https://github.com@evil.example/acme/portal", "https://github.com.evil.io/acme/portal", "file:///acme/portal", ""])("treats %j as unapproved", async (url) => {
    const out = await world().run(update, url);
    expect(out.exitCode).toBe(1);
  });

  it("an unparsable destination is described as such and never echoed (it may contain credentials)", async () => {
    const url = "https://user:pw-" + "x".repeat(8) + "@@bad host/x";
    const w = world();
    const out = await w.run(update, url);
    expect(out.lines.join("\n")).toContain("could not be parsed");
    expect(JSON.stringify([out, w.events.events])).not.toContain("pw-");
    expect(w.events.events[0]?.destination).toBeNull();
  });

  it("blocks a secret in an added line and reports rule, path, line and commit but never the secret", async () => {
    const w = world({ git: { lines: { [C1]: [{ path: "src/config.ts", line: 12, text: `const t = "${secret()}";` }] } } });
    const out = await w.run(update);
    const text = out.lines.join("\n");
    expect(out.exitCode).toBe(1);
    expect(text).toContain("secret: github_token  src/config.ts:12 (commit 1111111)");
    expect(JSON.stringify([out, w.events.events])).not.toContain(secret());
    expect(JSON.stringify([out, w.events.events])).not.toContain("Q".repeat(20));
    expect(w.events.events[0]).toMatchObject({ outcome: "blocked", ruleIds: ["secret_detected"] });
    expect(w.events.events[0]?.findings).toEqual([{ ruleId: "github_token", kind: "secret", path: "src/config.ts", commit: C1, line: 12 }]);
  });

  it("blocks a prohibited file", async () => {
    const out = await world({ git: { paths: { [C1]: [{ path: "deploy/.env", status: "A" }] } } }).run(update);
    expect(out.exitCode).toBe(1);
    expect(out.lines.join("\n")).toContain("prohibited file: prohibited_file  deploy/.env");
  });

  it("reports every violation together", async () => {
    const w = world({ git: { paths: { [C1]: [{ path: ".env", status: "A" }] }, lines: { [C1]: [{ path: "a.ts", line: 1, text: secret() }] } } });
    const out = await w.run(update, OTHER_URL);
    expect(w.events.events[0]?.ruleIds).toEqual(["destination_not_approved", "secret_detected", "prohibited_file"]);
    expect(out.lines.join("\n")).toMatch(/not approved[\s\S]*possible secret[\s\S]*prohibited file/);
  });

  it("sanitises control characters in file names before they reach the terminal", async () => {
    const out = await world({ git: { paths: { [C1]: [{ path: "evil\u001b[31m\nname/.env", status: "A" }] } } }).run(update);
    const text = out.lines.join("\n");
    expect(text).not.toContain("\u001b");
    expect(text).toContain("evil?[31m?name/.env");
  });

  it("a multi-ref push is blocked as a whole when one ref violates", async () => {
    const D = "d".repeat(40);
    const E = "e".repeat(40);
    const C2 = "2".repeat(40);
    const w = world({
      git: {
        knownObjects: [B, E],
        ancestors: [`${B}>${A}`, `${E}>${D}`],
        commits: { [A]: [C1], [D]: [C2] },
        lines: { [C2]: [{ path: "x.ts", line: 1, text: secret() }] },
      },
    });
    const out = await w.run(stdin(["refs/heads/a", A, "refs/heads/a", B], ["refs/heads/b", D, "refs/heads/b", E]));
    expect(out.exitCode).toBe(1);
    expect(w.events.events[0]?.refs).toEqual(["refs/heads/a", "refs/heads/b"]);
  });

  it("a deletion is judged by destination only and recorded as a branch delete", async () => {
    const del = stdin(["(delete)", ZERO, "refs/heads/old", B]);
    const allowed = world({ git: { failing: [{ method: "listCommits" }] } });
    expect((await allowed.run(del)).exitCode).toBe(0);
    expect(allowed.events.events[0]?.operation).toBe("branch_delete");
    expect((await world().run(del, OTHER_URL)).exitCode).toBe(1);
  });

  it("flags a force-push, shows it when blocking, and records the operation", async () => {
    const w = world({ git: { ancestors: [] } });
    const out = await w.run(update, OTHER_URL);
    expect(out.lines.join("\n")).toContain("force-push");
    expect(w.events.events[0]?.operation).toBe("force_push");
  });

  it("a clean force-push to an approved destination is allowed (and recorded as a force-push)", async () => {
    const w = world({ git: { ancestors: [] } });
    expect(await w.run(update)).toEqual({ exitCode: 0, lines: [] });
    expect(w.events.events[0]?.operation).toBe("force_push");
  });

  it("records tag pushes and new branches", async () => {
    const tag = world();
    await tag.run(stdin(["refs/tags/v1", A, "refs/tags/v1", ZERO]));
    expect(tag.events.events[0]?.operation).toBe("tag_push");
    const created = world();
    await created.run(stdin(["refs/heads/new", A, "refs/heads/new", ZERO]));
    expect(created.events.events[0]?.operation).toBe("branch_create");
  });

  it("uses the remote name Git passed to find commits not already on the remote", async () => {
    const w = world();
    await runPrePush({ remoteName: "upstream", remoteUrl: OK_URL, stdin: stdin(["refs/heads/new", A, "refs/heads/new", ZERO]), cwd: "/repo" }, { store: fakeStore({ repos: ok({ repos: [{ repoPath: "/repo", projectId: "proj-1", registeredAt: "2026-06-01T12:00:00.000Z" }] }) }, { "proj-1": ok(cachedPolicy("proj-1")) }), git: w.git, events: w.events, clock: fixedClock(), newId: sequentialIds(), agentVersion: "0", maxStaleMinutes: 60 });
    expect(w.git.calls[0]?.args[1]).toEqual({ kind: "remote", name: "upstream" });
  });
});

describe("audit-only mode", () => {
  const audit = { policy: (p: CachedPolicy) => void (p.project.policy.mode = "audit_only") };

  it("allows a violating push, says it would have been blocked, and records wouldBlock", async () => {
    const w = world({ ...audit, git: { lines: { [C1]: [{ path: "a.ts", line: 1, text: secret() }] } } });
    const out = await w.run(update, OTHER_URL);
    expect(out.exitCode).toBe(0);
    expect(out.lines.join("\n")).toContain("audit-only");
    expect(out.lines.join("\n")).toContain("would be blocked");
    expect(w.events.events[0]).toMatchObject({ outcome: "allowed", wouldBlock: true, mode: "audit_only", ruleIds: ["destination_not_approved", "secret_detected"] });
  });

  it("a clean push is silent", async () => {
    expect(await world(audit).run(update)).toEqual({ exitCode: 0, lines: [] });
  });
});

describe("failures after the project is known follow the mode", () => {
  const broken = { git: { failing: [{ method: "listCommits" as const }] } };

  it("enforce: a Git failure blocks with a reference and an error event", async () => {
    const w = world(broken);
    const out = await w.run(stdinNewBranch());
    expect(out.exitCode).toBe(1);
    expect(out.lines.join("\n")).toContain("hit an internal error");
    expect(out.lines.join("\n")).toContain("Reference: id-00000001");
    expect(w.events.events[0]).toMatchObject({ outcome: "error", ruleIds: ["internal_error"], projectId: "proj-1", mode: "enforce", wouldBlock: true });
  });

  it("audit-only: a Git failure allows the push and records the error", async () => {
    const w = world({ ...broken, policy: (p) => void (p.project.policy.mode = "audit_only") });
    const out = await w.run(stdinNewBranch());
    expect(out.exitCode).toBe(0);
    expect(w.events.events[0]).toMatchObject({ outcome: "error", mode: "audit_only" });
  });

  it("a commit that cannot be scanned blocks in enforce and is allowed with a record in audit-only", async () => {
    const git = { failing: [{ method: "changedPaths" as const, commit: C1 }] };
    const enforce = world({ git });
    expect((await enforce.run(update)).exitCode).toBe(1);
    expect(enforce.events.events[0]?.ruleIds).toEqual(["scan_error"]);
    const audited = world({ git, policy: (p) => void (p.project.policy.mode = "audit_only") });
    expect((await audited.run(update)).exitCode).toBe(0);
    expect(audited.events.events[0]).toMatchObject({ outcome: "allowed", wouldBlock: true, ruleIds: ["scan_error"] });
  });

  it("too many commits is a scan error, so an enforce-mode push is blocked", async () => {
    const out = await world({ git: { truncated: [A] } }).run(update);
    expect(out.exitCode).toBe(1);
    expect(out.lines.join("\n")).toContain("could not be fully checked");
  });

  it("an invalid cached policy (possible only if the store let it through) is an error outcome, which blocks in enforce", async () => {
    const w = world({ policy: (p) => void ((p.project.policy as unknown as { mode: string }).mode = "yolo") });
    const out = await w.run(update);
    expect(out.exitCode).toBe(1);
    expect(w.events.events[0]).toMatchObject({ outcome: "error" });
  });
});

function stdinNewBranch(): string {
  return stdin(["refs/heads/new", A, "refs/heads/new", ZERO]);
}

describe("event recording never changes the decision", () => {
  it("a failing event log does not turn a block into an allow, or the reverse, and the developer is told", async () => {
    const blockedRun = world({ eventsFail: new Error("disk full") });
    const blocked = await blockedRun.run(update, OTHER_URL);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.lines.at(-1)).toContain("could not record this event");
    const allowed = await world({ eventsFail: new Error("disk full") }).run(update);
    expect(allowed.exitCode).toBe(0);
    expect(allowed.lines).toEqual(["DevGuard could not record this event in its local log."]);
  });

  it("recorded events satisfy the shared contract and use distinct correlation and idempotency ids", async () => {
    const w = world({ git: { lines: { [C1]: [{ path: "a.ts", line: 3, text: secret() }] } } });
    await w.run(update, OTHER_URL);
    await world({ registered: true }).run("garbage");
    for (const event of w.events.events) {
      expect(SecurityEventInputSchema.safeParse(event).success).toBe(true);
      expect(event.idempotencyKey).not.toBe(event.correlationId);
    }
    expect(w.events.events[0]?.occurredAt).toBe("2026-06-01T12:00:00.000Z");
  });

  it("does not depend on the wall clock", async () => {
    const real = Date.now;
    try {
      Date.now = () => new Date("2099-01-01T00:00:00Z").getTime();
      expect((await world().run(update)).exitCode).toBe(0);
    } finally {
      Date.now = real;
    }
  });
});

describe("never leaks", () => {
  it("no part of any outgoing line or the raw URL appears in output or events", async () => {
    const url = "https://deploy:tok-" + "z".repeat(8) + "@github.com/personal/fork.git";
    const w = world({ git: { lines: { [C1]: [{ path: "a.ts", line: 1, text: `x ${secret()} y` }] } } });
    const out = await w.run(update, url);
    const all = JSON.stringify([out, w.events.events]);
    for (const needle of [secret(), "tok-", "deploy:", "x " + secret()]) expect(all).not.toContain(needle);
  });
});

export type { RefUpdate };

describe("policy freshness (ADR-004)", () => {
  const server = (fetchedAt: string, mode: "enforce" | "audit_only" = "enforce") => ({
    policy: (p: CachedPolicy) => {
      p.source = "server";
      p.fetchedAt = fetchedAt;
      p.project.policy.mode = mode;
    },
  });
  const NOW = "2026-06-01T12:00:00.000Z";

  it.each([
    ["fetched just now", "2026-06-01T11:58:00.000Z"],
    ["fetched 59 minutes ago (stale but within the limit)", "2026-06-01T11:01:00.000Z"],
  ])("enforces normally when the cached server policy was %s", async (_name, fetchedAt) => {
    const w = world({ ...server(fetchedAt), now: NOW });
    expect((await w.run(update)).exitCode).toBe(0);
    expect((await w.run(update, OTHER_URL)).exitCode).toBe(1);
    expect(w.events.events[0]?.ruleIds).toEqual([]);
  });

  it("blocks an enforced project whose server policy is past the limit, even for an approved destination, and says why", async () => {
    const w = world({ ...server("2026-06-01T10:00:00.000Z"), now: NOW });
    const out = await w.run(update);
    expect(out.exitCode).toBe(1);
    expect(out.lines.join("\n")).toContain("out of date");
    expect(out.lines.join("\n")).toContain("devguard sync");
    expect(w.events.events[0]).toMatchObject({ outcome: "blocked", ruleIds: ["policy_unavailable"], mode: "enforce", wouldBlock: true, projectId: "proj-1" });
  });

  it("allows and records an audit-only project whose server policy is past the limit", async () => {
    const w = world({ ...server("2026-06-01T10:00:00.000Z", "audit_only"), now: NOW });
    const out = await w.run(update, OTHER_URL);
    expect(out.exitCode).toBe(0);
    expect(out.lines.join("\n")).toContain("allowed and recorded");
    expect(w.events.events[0]).toMatchObject({ outcome: "allowed", ruleIds: ["policy_unavailable"], mode: "audit_only", wouldBlock: true });
  });

  it.each([["a timestamp in the future", "2026-06-02T12:00:00.000Z"], ["an unparsable timestamp", "yesterday"]])("treats %s as expired (it cannot prove it is recent)", async (_name, fetchedAt) => {
    const w = world({ ...server(fetchedAt), now: NOW });
    expect((await w.run(update)).exitCode).toBe(1);
  });

  it("respects the configured limit", async () => {
    const w = world({ ...server("2026-06-01T11:30:00.000Z"), now: NOW, deps: { maxStaleMinutes: 10 } });
    expect((await w.run(update)).exitCode).toBe(1);
  });

  it("a stricter project still blocks when another matched project is fresh (any one may block)", async () => {
    const w = world({ ...server("2026-06-01T10:00:00.000Z"), now: NOW });
    expect((await w.run(update)).exitCode).toBe(1);
  });
});

describe("refresh and learn (best effort)", () => {
  /** A store whose cached policy appears only after `refresh` runs, like a first sync after assignment. */
  function lateAssignment(refresh: () => Promise<void>) {
    let cached: CachedPolicy | undefined;
    const base = fakeStore({}, {});
    const store = {
      ...base,
      listPolicyIds: async () => ok(cached === undefined ? [] : ["proj-1"]),
      readPolicy: async () => ok(cached),
    };
    const events = memoryEvents();
    const git = fakeGit({ knownObjects: [B], ancestors: [`${B}>${A}`], commits: { [A]: [C1] }, remotes: [OK_URL] });
    const deps: PrePushDeps = {
      store,
      git,
      events,
      clock: fixedClock(),
      newId: sequentialIds("id"),
      agentVersion: "9.9.9",
      maxStaleMinutes: 60,
      refresh: async () => {
        await refresh();
        const policy = cachedPolicy("proj-1");
        policy.source = "server";
        cached = policy;
      },
    };
    return { run: (url: string) => runPrePush({ remoteName: "origin", remoteUrl: url, stdin: update, cwd: "/repo" }, deps), events };
  }

  it("syncs before deciding, so a project assigned since the last push is enforced on this one", async () => {
    const w = lateAssignment(async () => undefined);
    const out = await w.run(OTHER_URL);
    expect(out.exitCode).toBe(1);
    expect(w.events.events[0]).toMatchObject({ projectId: "proj-1", outcome: "blocked" });
  });

  it("a failing refresh changes nothing: the cache decides", async () => {
    const w = world({ deps: { refresh: async () => Promise.reject(new Error("offline")) } });
    expect((await w.run(update)).exitCode).toBe(0);
    expect((await w.run(update, OTHER_URL)).exitCode).toBe(1);
  });

  it("offers the matches to learn() and survives it failing", async () => {
    const seen: string[] = [];
    const w = world({ deps: { learn: async (m, url) => void seen.push(`${m.length}:${url}`) } });
    await w.run(update);
    expect(seen).toEqual([`1:${OK_URL}`]);
    const failing = world({ deps: { learn: async () => Promise.reject(new Error("boom")) } });
    expect((await failing.run(update)).exitCode).toBe(0);
  });

  it("does not call learn() for a repo that matches no project", async () => {
    let called = false;
    const w = world({ registered: false, deps: { learn: async () => void (called = true) } });
    await w.run(update, "garbage");
    expect(called).toBe(false);
  });
});

describe("approved exceptions (ADR-007)", () => {
  const exception = (over: Partial<ValidException> = {}): ValidException => ({
    id: "exc-1",
    projectId: "proj-1",
    destination: { host: "github.com", repoPath: "personal/fork" },
    status: "approved",
    expiresAt: "2026-06-02T12:00:00.000Z",
    approverId: "admin-1",
    requesterId: "user-1",
    waivedRuleIds: [],
    ...over,
  });
  const grant = (e: ValidException = exception()) => ({ checkException: async () => ({ state: "valid" as const, exception: e }) });

  it("an approved exception lets the push to the unapproved destination through, recorded as outcome exception with its id", async () => {
    const w = world({ deps: grant() });
    const out = await w.run(update, OTHER_URL);
    expect(out.exitCode).toBe(0);
    expect(out.lines.join("\n")).toContain("allowed by approved exception exc-1");
    expect(w.events.events[0]).toMatchObject({ outcome: "exception", exceptionId: "exc-1", projectId: "proj-1", destination: { host: "github.com", repoPath: "personal/fork" } });
  });

  it("asks the server only when the destination is what blocks, with the project and the raw URL for the server to normalise", async () => {
    const asked: string[][] = [];
    const w = world({ deps: { checkException: async (p, d) => (asked.push([p, d]), { state: "none" as const }) } });
    await w.run(update, OTHER_URL);
    expect(asked).toEqual([["proj-1", OTHER_URL]]);
    await w.run(update); // approved destination: nothing to ask
    expect(asked).toHaveLength(1);
  });

  it("an exception does not waive content findings: a secret still blocks", async () => {
    const w = world({ deps: grant(), git: { lines: { [C1]: [{ path: "a.ts", line: 1, text: secret() }] } } });
    const out = await w.run(update, OTHER_URL);
    expect(out.exitCode).toBe(1);
    expect(w.events.events[0]).toMatchObject({ outcome: "blocked" });
    expect(w.events.events[0]?.ruleIds).toContain("secret_detected");
  });

  it.each([
    ["no exception", { state: "none" as const }],
    ["the server unreachable", { state: "unavailable" as const }],
  ])("blocks as before with %s", async (_name, check) => {
    const w = world({ deps: { checkException: async () => check } });
    expect((await w.run(update, OTHER_URL)).exitCode).toBe(1);
    expect(w.events.events[0]).toMatchObject({ outcome: "blocked", ruleIds: ["destination_not_approved"] });
  });

  it("says plainly that exceptions need the server when it could not be asked", async () => {
    const w = world({ deps: { checkException: async () => ({ state: "unavailable" as const }) } });
    const text = (await w.run(update, OTHER_URL)).lines.join("\n");
    expect(text).toContain("could not be checked because the DevGuard server is unreachable");
  });

  it("a checkException that throws blocks like an unreachable server", async () => {
    const w = world({ deps: { checkException: async () => Promise.reject(new Error("boom")) } });
    const out = await w.run(update, OTHER_URL);
    expect(out.exitCode).toBe(1);
    expect(out.lines.join("\n")).toContain("could not be checked");
  });

  it.each([
    ["an exception for another destination", exception({ destination: { host: "github.com", repoPath: "someone/else" } })],
    ["an exception for another project", exception({ projectId: "proj-other" })],
    ["an expired exception", exception({ expiresAt: "2026-05-01T00:00:00.000Z" })],
    ["a self-approved exception", exception({ approverId: "user-1" })],
    ["an exception that is not approved", exception({ status: "revoked" })],
  ])("the engine still refuses %s even if the server's answer were wrong", async (_name, bad) => {
    const w = world({ deps: grant(bad) });
    expect((await w.run(update, OTHER_URL)).exitCode).toBe(1);
  });

  it("the block message carries a ready command to request an exception", async () => {
    const w = world();
    const text = (await w.run(update, OTHER_URL)).lines.join("\n");
    expect(text).toContain("devguard request-exception --project proj-1 --destination https://github.com/personal/fork --reason");
  });

  it("does not offer the command when the destination is not the problem", async () => {
    const w = world({ git: { lines: { [C1]: [{ path: "a.ts", line: 1, text: secret() }] } } });
    const text = (await w.run(update)).lines.join("\n");
    expect(text).not.toContain("request-exception");
  });
});
