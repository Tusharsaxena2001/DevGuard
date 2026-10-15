import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPolicyFileReader } from "./policy-file.js";

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), "dg-policyfile-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const reader = createPolicyFileReader();

describe("createPolicyFileReader", () => {
  it("reads JSON from a regular file", async () => {
    writeFileSync(join(dir, "p.json"), '{"a":1}');
    expect(await reader.read(join(dir, "p.json"))).toEqual({ ok: true, value: { a: 1 } });
  });
  it("reports non-JSON, a missing file and a directory", async () => {
    writeFileSync(join(dir, "bad.json"), "{nope");
    expect(await reader.read(join(dir, "bad.json"))).toEqual({ ok: false, reason: "not_json" });
    expect(await reader.read(join(dir, "absent.json"))).toEqual({ ok: false, reason: "unreadable" });
    expect(await reader.read(dir)).toEqual({ ok: false, reason: "unreadable" });
  });
  it("refuses a file over the size limit without reading it", async () => {
    writeFileSync(join(dir, "big.json"), `"${"x".repeat(1024 * 1024)}"`);
    expect(await reader.read(join(dir, "big.json"))).toEqual({ ok: false, reason: "too_large" });
  });
  it("refuses a final symlink and a FIFO (which would block forever)", async () => {
    writeFileSync(join(dir, "real.json"), "{}");
    symlinkSync(join(dir, "real.json"), join(dir, "link.json"));
    expect(await reader.read(join(dir, "link.json"))).toEqual({ ok: false, reason: "unreadable" });
    execFileSync("mkfifo", [join(dir, "fifo.json")]);
    expect(await reader.read(join(dir, "fifo.json"))).toEqual({ ok: false, reason: "unreadable" });
  });
});
