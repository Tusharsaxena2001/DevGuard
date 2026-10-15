import { describe, expect, it } from "vitest";
import type { RefUpdate } from "@devguard/shared";
import { fakeGit } from "../../test/support/fakes.js";
import { MAX_COMMITS, scanOutgoing } from "./scan-outgoing.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C1 = "1".repeat(40);
const C2 = "2".repeat(40);
const ZERO = "0".repeat(40);

const secret = (): string => "gh" + "p_" + "Q".repeat(36);
const ref = (over: Partial<RefUpdate> = {}): RefUpdate => ({ localRef: "refs/heads/m", localSha: A, remoteRef: "refs/heads/m", remoteSha: B, kind: "update", forcePush: false, ...over });

describe("scanOutgoing", () => {
  it("flags prohibited files and secrets found in each commit, with commit, path and line", async () => {
    const git = fakeGit({
      knownObjects: [B],
      ancestors: [`${B}>${A}`],
      commits: { [A]: [C1, C2] },
      paths: { [C1]: [{ path: "src/a.ts", status: "M" }], [C2]: [{ path: "deploy/.env", status: "A" }] },
      lines: { [C1]: [{ path: "src/a.ts", line: 7, text: `token = "${secret()}"` }] },
    });
    const scan = await scanOutgoing(git, [ref()], "origin", ["github_token"], [".env"]);
    expect(scan.commitCount).toBe(2);
    expect(scan.findings).toEqual([
      { ruleId: "prohibited_file", kind: "prohibited_file", path: "deploy/.env", commit: C2 },
      { ruleId: "github_token", kind: "secret", path: "src/a.ts", commit: C1, line: 7 },
    ]);
    expect(JSON.stringify(scan.findings)).not.toContain(secret());
  });

  it("does not pass deleted files to the file-name rule (removing a .env is the fix, not a violation)", async () => {
    const git = fakeGit({ knownObjects: [B], ancestors: [`${B}>${A}`], commits: { [A]: [C1] }, paths: { [C1]: [{ path: ".env", status: "D" }] } });
    expect((await scanOutgoing(git, [ref()], "origin", [], [".env"])).findings).toEqual([]);
  });

  it("a file added in one commit and deleted in the next is flagged in the adding commit", async () => {
    const git = fakeGit({
      knownObjects: [B],
      ancestors: [`${B}>${A}`],
      commits: { [A]: [C2, C1] },
      paths: { [C1]: [{ path: ".env", status: "A" }], [C2]: [{ path: ".env", status: "D" }] },
    });
    const scan = await scanOutgoing(git, [ref()], "origin", [], [".env"]);
    expect(scan.findings).toEqual([{ ruleId: "prohibited_file", kind: "prohibited_file", path: ".env", commit: C1 }]);
  });

  it("with no secret rules enabled it never asks Git for diffs", async () => {
    const git = fakeGit({ knownObjects: [B], ancestors: [`${B}>${A}`], commits: { [A]: [C1] }, failing: [{ method: "addedLines" }] });
    expect((await scanOutgoing(git, [ref()], "origin", [], [".env"])).findings).toEqual([]);
  });

  it("a commit Git cannot inspect becomes a scan_error finding, and the other commits are still scanned", async () => {
    const git = fakeGit({
      knownObjects: [B],
      ancestors: [`${B}>${A}`],
      commits: { [A]: [C1, C2] },
      paths: { [C2]: [{ path: ".env", status: "A" }] },
      failing: [{ method: "changedPaths", commit: C1 }],
    });
    const scan = await scanOutgoing(git, [ref()], "origin", [], [".env"]);
    expect(scan.findings.map((f) => [f.kind, f.commit])).toEqual([["scan_error", C1], ["prohibited_file", C2]]);
  });

  it("more commits than the limit is a scan_error, not a silent partial scan", async () => {
    const git = fakeGit({ knownObjects: [B], ancestors: [`${B}>${A}`], commits: { [A]: [C1] }, truncated: [A] });
    const scan = await scanOutgoing(git, [ref()], "origin", [], []);
    expect(scan.findings).toEqual([{ ruleId: "scan_error", kind: "scan_error", path: "(too many commits to scan)", commit: A }]);
    expect(git.calls[0]?.args[2]).toBe(MAX_COMMITS);
  });

  it.each([["blob"], ["tree"], [undefined]])("a ref that points at a %s is reported (not silently 'scanned' as empty) and not listed", async (type) => {
    const git = fakeGit({ objectTypes: { [A]: type }, commits: { [A]: [C1] }, failing: [{ method: "listCommits" }] });
    const scan = await scanOutgoing(git, [ref({ kind: "create", remoteSha: ZERO })], "origin", ["github_token"], [".env"]);
    expect(scan.findings).toEqual([{ ruleId: "scan_error", kind: "scan_error", path: "(pushed object is not a commit)", commit: A }]);
  });

  it("a deletion is never scanned", async () => {
    const git = fakeGit({ failing: [{ method: "listCommits" }, { method: "objectExists" }] });
    const scan = await scanOutgoing(git, [ref({ kind: "delete", localSha: ZERO, localRef: "(delete)" })], "origin", ["github_token"], [".env"]);
    expect(scan).toEqual({ commitCount: 0, findings: [], forcePush: new Map() });
  });

  describe("baseline and force-push detection", () => {
    it("a new branch scans what the remote's tracking refs do not have, and is not a force-push", async () => {
      const git = fakeGit({ commits: { [A]: [C1] } });
      const scan = await scanOutgoing(git, [ref({ kind: "create", remoteSha: ZERO })], "origin", [], []);
      expect(git.calls[0]?.args[1]).toEqual({ kind: "remote", name: "origin" });
      expect(scan.forcePush.get("refs/heads/m")).toBe(false);
    });

    it("a fast-forward update scans remote..local and is not a force-push", async () => {
      const git = fakeGit({ knownObjects: [B], ancestors: [`${B}>${A}`], commits: { [A]: [C1] } });
      const scan = await scanOutgoing(git, [ref()], "origin", [], []);
      expect(git.calls[0]?.args[1]).toEqual({ kind: "commit", sha: B });
      expect(scan.forcePush.get("refs/heads/m")).toBe(false);
    });

    it("a rewritten remote ref (not an ancestor) is flagged as a force-push", async () => {
      const git = fakeGit({ knownObjects: [B], commits: { [A]: [C1] } });
      expect((await scanOutgoing(git, [ref()], "origin", [], [])).forcePush.get("refs/heads/m")).toBe(true);
    });

    it("a remote sha not present locally is flagged and the whole unpushed history is scanned", async () => {
      const git = fakeGit({ commits: { [A]: [C1] } });
      const scan = await scanOutgoing(git, [ref()], "origin", [], []);
      expect(git.calls[0]?.args[1]).toEqual({ kind: "remote", name: "origin" });
      expect(scan.forcePush.get("refs/heads/m")).toBe(true);
    });
  });

  it("a commit reachable from two refs is inspected once", async () => {
    const git = fakeGit({
      knownObjects: [B],
      ancestors: [`${B}>${A}`],
      commits: { [A]: [C1] },
      paths: { [C1]: [{ path: ".env", status: "A" }] },
    });
    const refs = [ref(), ref({ remoteRef: "refs/heads/other" })];
    const scan = await scanOutgoing(git, refs, "origin", [], [".env"]);
    expect(scan.commitCount).toBe(1);
    expect(scan.findings).toHaveLength(1);
  });

  it("a Git failure while listing commits propagates (the runner turns it into an error outcome)", async () => {
    const git = fakeGit({ failing: [{ method: "listCommits" }] });
    await expect(scanOutgoing(git, [ref({ kind: "create", remoteSha: ZERO })], "origin", [], [])).rejects.toThrow();
  });
});
