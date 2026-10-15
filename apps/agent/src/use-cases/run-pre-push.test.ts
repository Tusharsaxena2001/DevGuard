import { describe, expect, it } from "vitest";
import { SecurityEventInputSchema, type RefUpdate } from "@devguard/shared";
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
}

function world(w: World = {}) {
  const policy = cachedPolicy("proj-1");
  w.policy?.(policy);
  const repos = w.reposRead ?? ok({ repos: w.registered === false ? [] : [{ repoPath: "/repo", projectId: "proj-1", registeredAt: "2026-06-01T12:00:00.000Z" }] });
  const store = fakeStore({ repos }, { "proj-1": w.policyRead ?? ok(policy) });
  const events = memoryEvents(w.eventsFail);
  const git = fakeGit({ knownObjects: [B], ancestors: [`${B}>${A}`], commits: { [A]: [C1] }, ...w.git });
  const deps: PrePushDeps = { store, git, events, clock: fixedClock(), newId: sequentialIds("id"), agentVersion: "9.9.9" };
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

  it("policy age is deliberately not evaluated yet (ADR-004 staleness arrives with policy sync, AG-6): an old cached policy is still enforced", async () => {
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
    await runPrePush({ remoteName: "upstream", remoteUrl: OK_URL, stdin: stdin(["refs/heads/new", A, "refs/heads/new", ZERO]), cwd: "/repo" }, { store: fakeStore({ repos: ok({ repos: [{ repoPath: "/repo", projectId: "proj-1", registeredAt: "2026-06-01T12:00:00.000Z" }] }) }, { "proj-1": ok(cachedPolicy("proj-1")) }), git: w.git, events: w.events, clock: fixedClock(), newId: sequentialIds(), agentVersion: "0" });
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
