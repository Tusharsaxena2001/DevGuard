import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SecurityEventInput } from "@devguard/shared";
import { createFsEventSpool } from "./fs-event-spool.js";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "devguard-spool-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const event = (n: number, over: Partial<SecurityEventInput> = {}): SecurityEventInput => ({
  idempotencyKey: `key-${String(n).padStart(6, "0")}`,
  correlationId: `corr-${String(n).padStart(6, "0")}`,
  occurredAt: new Date(Date.UTC(2026, 5, 1, 12, 0, n)).toISOString(),
  projectId: null,
  destination: { host: "github.com", repoPath: "acme/portal" },
  operation: "push",
  refs: ["refs/heads/main"],
  outcome: "blocked",
  ruleIds: ["destination_not_approved"],
  findings: [],
  mode: "enforce",
  wouldBlock: true,
  policyVersion: 1,
  agentVersion: "0.1.0",
  ...over,
});

describe("fs event spool", () => {
  it("stores events privately and returns them oldest first, whatever order they arrived in", async () => {
    const spool = createFsEventSpool(home);
    await spool.add(event(3));
    await spool.add(event(1));
    await spool.add(event(2));
    expect((await spool.peek(10)).map((p) => p.key)).toEqual(["key-000001", "key-000002", "key-000003"]);
    expect((await spool.peek(2)).length).toBe(2);
    const dir = join(home, "spool");
    const files = await readdir(dir);
    expect(files).toHaveLength(3);
    for (const f of files) expect((await stat(join(dir, f))).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it("removes delivered events by key and reports the pending count", async () => {
    const spool = createFsEventSpool(home);
    for (const n of [1, 2, 3]) await spool.add(event(n));
    await spool.remove(["key-000002", "key-does-not-exist"]);
    expect((await spool.peek(10)).map((p) => p.key)).toEqual(["key-000001", "key-000003"]);
    expect(await spool.stats()).toEqual({ pending: 2, dropped: 0 });
  });

  it("discard removes events and counts them as lost, unlike remove", async () => {
    const spool = createFsEventSpool(home);
    for (const n of [1, 2, 3]) await spool.add(event(n));
    await spool.remove(["key-000001"]);
    await spool.discard(["key-000002", "key-not-there"]);
    expect(await spool.stats()).toEqual({ pending: 1, dropped: 1 });
  });

  it("adding the same event twice keeps one entry", async () => {
    const spool = createFsEventSpool(home);
    await spool.add(event(1));
    await spool.add(event(1));
    expect((await spool.stats()).pending).toBe(1);
  });

  it("is bounded: when full the oldest events are dropped and counted", async () => {
    const spool = createFsEventSpool(home, { maxEvents: 3 });
    for (const n of [1, 2, 3, 4, 5]) await spool.add(event(n));
    expect((await spool.peek(10)).map((p) => p.key)).toEqual(["key-000003", "key-000004", "key-000005"]);
    expect(await spool.stats()).toEqual({ pending: 3, dropped: 2 });
  });

  it("refuses an invalid event and an unsafe key, storing nothing", async () => {
    const spool = createFsEventSpool(home);
    await expect(spool.add({ ...event(1), extra: "content" } as never)).rejects.toMatchObject({ code: "store_write_failed" });
    await expect(spool.add(event(1, { idempotencyKey: "../../escape-me" }))).rejects.toMatchObject({ code: "store_write_failed" });
    expect((await spool.stats()).pending).toBe(0);
  });

  it("rejects, on write, a field that could carry file contents or a secret value", async () => {
    const synthetic = ["gh", "p_", "Q".repeat(36)].join("");
    const spool = createFsEventSpool(home);
    await expect(spool.add({ ...event(1), findings: [{ ruleId: "github_token", kind: "secret", path: "a.ts", match: synthetic }] } as never)).rejects.toBeDefined();
    expect((await spool.stats()).pending).toBe(0);
  });

  it("discards and counts a damaged or forged entry instead of letting it block the queue", async () => {
    const spool = createFsEventSpool(home);
    await spool.add(event(2));
    const dir = join(home, "spool");
    await writeFile(join(dir, `${"1".padStart(15, "0")}-key-corrupt1.json`), "{ not json", { mode: 0o600 });
    await writeFile(join(dir, `${"2".padStart(15, "0")}-key-forged01.json`), JSON.stringify({ ...event(9), content: "x" }), { mode: 0o600 });
    expect((await spool.peek(10)).map((p) => p.key)).toEqual(["key-000002"]);
    expect(await spool.stats()).toEqual({ pending: 1, dropped: 2 });
  });

  it("does not trust a spool directory that other users can write to", async () => {
    const spool = createFsEventSpool(home);
    await spool.add(event(1));
    await chmod(join(home, "spool"), 0o777);
    expect(await spool.peek(10)).toEqual([]);
    expect(await spool.stats()).toMatchObject({ pending: 0 });
    await chmod(join(home, "spool"), 0o700);
  });

  it("ignores files that are not spool entries", async () => {
    const spool = createFsEventSpool(home);
    await spool.add(event(1));
    await writeFile(join(home, "spool", "notes.txt"), "hello", { mode: 0o600 });
    expect(await spool.stats()).toMatchObject({ pending: 1 });
    expect(await readFile(join(home, "spool", "notes.txt"), "utf8")).toBe("hello");
  });

  it("an empty or missing spool is simply empty", async () => {
    const spool = createFsEventSpool(join(home, "never-created"));
    expect(await spool.peek(5)).toEqual([]);
    expect(await spool.stats()).toEqual({ pending: 0, dropped: 0 });
    await spool.remove(["anything"]);
  });
});
