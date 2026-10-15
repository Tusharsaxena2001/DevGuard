import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HookFiles } from "../../ports/hook-files.js";
import { createFsHookFiles } from "./fs-hook-files.js";

let root: string;
let files: HookFiles;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "devguard-hooks-"));
  files = createFsHookFiles();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const mode = (p: string): number => statSync(p).mode & 0o777;

describe("createFsHookFiles", () => {
  it("writes an executable 0755 script atomically, creating a 0700 directory, with no temp files left", async () => {
    const path = join(root, "hooks", "pre-push");
    await files.writeExecutable(path, "#!/bin/sh\nexit 0\n");
    expect(readFileSync(path, "utf8")).toBe("#!/bin/sh\nexit 0\n");
    expect(mode(path)).toBe(0o755);
    expect(mode(join(root, "hooks"))).toBe(0o700);
    expect(readdirSync(join(root, "hooks"))).toEqual(["pre-push"]);
  });

  it("replaces an existing file and tightens a loose mode", async () => {
    const path = join(root, "pre-push");
    writeFileSync(path, "old", { mode: 0o600 });
    await files.writeExecutable(path, "new");
    expect(readFileSync(path, "utf8")).toBe("new");
    expect(mode(path)).toBe(0o755);
  });

  it("replaces a symlink at the target rather than writing through it", async () => {
    const victim = join(root, "victim");
    writeFileSync(victim, "keep");
    const path = join(root, "pre-push");
    symlinkSync(victim, path);
    await files.writeExecutable(path, "script");
    expect(readFileSync(victim, "utf8")).toBe("keep");
    expect(readFileSync(path, "utf8")).toBe("script");
  });

  it("read returns undefined for a missing file or a directory, and the content otherwise", async () => {
    expect(await files.read(join(root, "nope"))).toBeUndefined();
    mkdirSync(join(root, "dir"));
    expect(await files.read(join(root, "dir"))).toBeUndefined();
    writeFileSync(join(root, "f"), "hi");
    expect(await files.read(join(root, "f"))).toBe("hi");
  });

  it("move keeps the file mode and content, and refuses to overwrite", async () => {
    const from = join(root, "a");
    const to = join(root, "b");
    writeFileSync(from, "A", { mode: 0o750 });
    chmodSync(from, 0o750);
    await files.move(from, to);
    expect(readFileSync(to, "utf8")).toBe("A");
    expect(mode(to)).toBe(0o750);
    expect(await files.read(from)).toBeUndefined();

    writeFileSync(from, "again");
    await expect(files.move(from, to)).rejects.toMatchObject({ code: "hook_files_failed" });
    expect(readFileSync(to, "utf8")).toBe("A");
    expect(readFileSync(from, "utf8")).toBe("again");
  });

  it("remove is idempotent", async () => {
    const path = join(root, "x");
    writeFileSync(path, "1");
    await files.remove(path);
    await files.remove(path);
    expect(await files.read(path)).toBeUndefined();
  });

  it("removeDirIfEmpty removes an empty directory and leaves a non-empty or missing one alone", async () => {
    mkdirSync(join(root, "empty"));
    await files.removeDirIfEmpty(join(root, "empty"));
    expect(readdirSync(root)).toEqual([]);
    mkdirSync(join(root, "full"));
    writeFileSync(join(root, "full", "keep"), "1");
    await files.removeDirIfEmpty(join(root, "full"));
    await files.removeDirIfEmpty(join(root, "missing"));
    expect(readdirSync(join(root, "full"))).toEqual(["keep"]);
  });

  it("reports a typed error and leaves no temp file when the directory cannot be created", async () => {
    writeFileSync(join(root, "blocker"), "x");
    await expect(files.writeExecutable(join(root, "blocker", "sub", "pre-push"), "x")).rejects.toMatchObject({ code: "hook_files_failed" });
    expect(readdirSync(root)).toEqual(["blocker"]);
  });
});
