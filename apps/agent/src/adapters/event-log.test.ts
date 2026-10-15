import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SecurityEventInput } from "@devguard/shared";
import { createEventLog } from "./event-log.js";

let root: string;
beforeEach(() => void (root = mkdtempSync(join(tmpdir(), "devguard-events-"))));
afterEach(() => rmSync(root, { recursive: true, force: true }));

const event = (over: Partial<SecurityEventInput> = {}): SecurityEventInput => ({
  idempotencyKey: "idem-0001",
  correlationId: "corr-0001",
  occurredAt: "2026-06-01T12:00:00.000Z",
  projectId: "proj-1",
  destination: { host: "github.com", repoPath: "acme/portal" },
  operation: "push",
  refs: ["refs/heads/main"],
  outcome: "blocked",
  ruleIds: ["secret_detected"],
  findings: [{ ruleId: "github_token", kind: "secret", path: "a.ts", commit: "c".repeat(40), line: 3 }],
  mode: "enforce",
  wouldBlock: false,
  policyVersion: 1,
  agentVersion: "0.0.0",
  ...over,
});

describe("createEventLog", () => {
  it("appends one JSON line per event to a private file, creating the directory privately", async () => {
    const home = join(root, "state");
    const log = createEventLog(home);
    await log.record(event());
    await log.record(event({ idempotencyKey: "idem-0002" }));
    const lines = readFileSync(join(home, "events.jsonl"), "utf8").trim().split("\n");
    expect(lines.map((l) => (JSON.parse(l) as SecurityEventInput).idempotencyKey)).toEqual(["idem-0001", "idem-0002"]);
    expect(statSync(join(home, "events.jsonl")).mode & 0o777).toBe(0o600);
    expect(statSync(home).mode & 0o777).toBe(0o700);
  });

  it("refuses an event that does not satisfy the strict contract (e.g. carrying file contents)", async () => {
    const log = createEventLog(root);
    const bad = { ...event(), diff: "secret content" } as unknown as SecurityEventInput;
    await expect(log.record(bad)).rejects.toMatchObject({ code: "store_write_failed" });
    const badFinding = event({ findings: [{ ruleId: "x", kind: "secret", path: "a", match: "ghp_x" } as never] });
    await expect(log.record(badFinding)).rejects.toMatchObject({ code: "store_write_failed" });
  });

  it("does not follow a symlink planted as the log file", async () => {
    const victim = join(root, "victim");
    writeFileSync(victim, "keep");
    symlinkSync(victim, join(root, "events.jsonl"));
    await expect(createEventLog(root).record(event())).rejects.toMatchObject({ code: "store_write_failed" });
    expect(readFileSync(victim, "utf8")).toBe("keep");
  });

  it("reports a typed error when the log cannot be written", async () => {
    writeFileSync(join(root, "blocker"), "x");
    await expect(createEventLog(join(root, "blocker", "home")).record(event())).rejects.toMatchObject({ code: "store_write_failed" });
  });
});
