import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticSecret } from "./support/fakes.js";

/** Runs the real composition root (src/main.ts) in-process with a given argv and environment. */
async function runMain(args: string[], env: Record<string, string | undefined>): Promise<{ code: number | string | undefined; out: string; err: string }> {
  vi.resetModules();
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  const saved = { argv: process.argv, exitCode: process.exitCode, env: { ...process.env } };
  process.argv = ["node", "devguard", ...args];
  process.exitCode = undefined;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await import("../src/main.js");
    return { code: process.exitCode, out: out.join(""), err: err.join("") };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    process.argv = saved.argv;
    process.exitCode = saved.exitCode;
    // Restore key by key: replacing the process.env object would disconnect it from the real environment.
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
    for (const [key, value] of Object.entries(saved.env)) if (value !== undefined) process.env[key] = value;
  }
}

let sandbox: string;
let fakeHome: string;
let stateDir: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "devguard-main-"));
  fakeHome = join(sandbox, "home");
  stateDir = join(sandbox, "state");
  await mkdir(fakeHome, { mode: 0o700 });
});
afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("main.ts (real composition root)", () => {
  it("--help exits 0 with usage on stdout and creates nothing, in DEVGUARD_HOME or HOME", async () => {
    const { code, out, err } = await runMain(["--help"], { HOME: fakeHome, DEVGUARD_HOME: stateDir });
    expect(code).toBe(0);
    expect(out).toContain("Usage: devguard");
    expect(err).toBe("");
    expect(await readdir(sandbox)).toEqual(["home"]);
    expect(await readdir(fakeHome)).toEqual([]);
  });

  it("a relative DEVGUARD_HOME exits 2 with a message on stderr and creates nothing", async () => {
    const { code, out, err } = await runMain(["status"], { HOME: fakeHome, DEVGUARD_HOME: "relative/dir" });
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("DEVGUARD_HOME must be an absolute path");
    expect(await readdir(fakeHome)).toEqual([]);
  });

  it("without DEVGUARD_HOME the state lives under $HOME/.config/devguard (and is not created by a read)", async () => {
    const { code, out } = await runMain(["status"], { HOME: fakeHome, DEVGUARD_HOME: undefined });
    expect(code).toBe(0);
    expect(out).toContain(join(fakeHome, ".config", "devguard"));
    expect(await readdir(fakeHome)).toEqual([]);
  });

  it("uses DEVGUARD_HOME for state, leaving HOME untouched", async () => {
    await mkdir(stateDir, { mode: 0o700 });
    await writeFile(join(stateDir, "config.json"), JSON.stringify({ serverUrl: "https://devguard.example.com", deviceId: "dev-9" }), { mode: 0o600 });
    const { code, out } = await runMain(["status"], { HOME: fakeHome, DEVGUARD_HOME: stateDir });
    expect(code).toBe(0);
    expect(out).toContain("dev-9");
    expect(await readdir(fakeHome)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("status exits 2 and refuses credentials with loose permissions, without printing them", async () => {
    await mkdir(stateDir, { mode: 0o700 });
    const file = join(stateDir, "credentials.json");
    await writeFile(file, JSON.stringify({ deviceId: "dev-9", deviceSecret: syntheticSecret() }), { mode: 0o600 });
    await chmod(file, 0o644);
    const { code, out, err } = await runMain(["status"], { HOME: fakeHome, DEVGUARD_HOME: stateDir });
    expect(code).toBe(2);
    expect(out).toContain("REFUSED");
    expect(out + err).not.toContain(syntheticSecret());
  });

  it("a usage error exits 2 through the real entry point", async () => {
    const { code, err } = await runMain(["request-exception"], { HOME: fakeHome, DEVGUARD_HOME: stateDir });
    expect(code).toBe(2);
    expect(err).toContain("required option");
  });

  it("a command that needs enrollment says so on an unenrolled device (exit 2, no network)", async () => {
    const { code, err } = await runMain(["request-exception", "--destination", "https://github.com/a/b", "--reason", "need it for the handover"], { HOME: fakeHome, DEVGUARD_HOME: stateDir });
    expect(code).toBe(2);
    expect(err).toContain("not enrolled");
  });
});

describe("entry point packaging", () => {
  it("main.ts starts with a node shebang and package.json exposes it as the devguard bin", async () => {
    const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { bin: Record<string, string> };
    expect(pkg.bin).toEqual({ devguard: "./dist/main.js" });
  });
});
