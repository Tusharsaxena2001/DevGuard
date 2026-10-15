import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { PASSTHROUGH_HOOKS, renderPassthrough, renderPrePushWrapper, shellQuote } from "../src/use-cases/hook-wrapper.js";

const run = promisify(execFile);
const agent = { nodePath: "/usr/bin/node", mainPath: "/opt/devguard/main.js", version: "1.2.3" };

/** `sh -n` parses a script without running it, so a quoting mistake shows up as a syntax error. */
function parses(script: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = execFile("sh", ["-n"], (error) => resolve(error === null));
    child.stdin?.end(script);
  });
}

describe("generated hook scripts are valid POSIX shell", () => {
  it("shellQuote round-trips hostile values through a real shell without executing them", async () => {
    for (const value of ["it's $(echo pwned) `echo pwned`", "a b;c", "~/x", "*", "$HOME", "a\\b"]) {
      const { stdout } = await run("sh", ["-c", `printf %s ${shellQuote(value)}`]);
      expect(stdout).toBe(value);
    }
  });

  it.each([
    ["global, no previous", { kind: "global", previousHooksDir: null } as const],
    ["global, previous", { kind: "global", previousHooksDir: "/o'dd dir" } as const],
    ["repo", { kind: "repo", hookPath: "/r/it's/pre-push", originalHook: "/r/it's/pre-push.devguard-orig" } as const],
  ])("pre-push wrapper (%s), even with hostile paths", async (_name, mode) => {
    const script = renderPrePushWrapper({ agent: { ...agent, nodePath: "/n o/d'e", mainPath: "/m$(x)/main.js" }, devguardHome: "/h o'me", mode });
    expect(await parses(script)).toBe(true);
  });

  it.each(PASSTHROUGH_HOOKS)("pass-through %s", async (name) => {
    expect(await parses(renderPassthrough(name, null))).toBe(true);
    expect(await parses(renderPassthrough(name, "/o'dd"))).toBe(true);
  });
});
