import { describe, expect, it } from "vitest";
import { AgentError } from "../errors.js";
import { fail, ok } from "../result.js";
import { cachedPolicy, cliDeps, fakeStore, recordingLogger, syntheticSecret, untouchableStore } from "../../test/support/fakes.js";
import { runCli } from "./run.js";

const REAL = ["status", "install", "uninstall", "enroll", "sync", "request-exception", "exception"];

describe("help and usage (no server, no local state needed)", () => {
  it("--help exits 0, lists the commands and hides the internal hook", async () => {
    const logger = recordingLogger();
    expect(await runCli(["--help"], cliDeps({ store: untouchableStore(), logger }))).toBe(0);
    const help = logger.out.join("\n");
    const commands = help.slice(help.indexOf("Commands:"));
    for (const name of REAL) expect(commands).toMatch(new RegExp(`^\\s+${name}\\s`, "m"));
    // The same pattern that must find real commands finds nothing for the internal hook entry point.
    expect(commands).not.toMatch(/^\s+hook\s/m);
  });

  it.each([[["-h"]], [["help"]], [["help", "status"]], [["status", "--help"]]])("%j exits 0 and prints usage", async (argv) => {
    const logger = recordingLogger();
    expect(await runCli(argv, cliDeps({ store: untouchableStore(), logger }))).toBe(0);
    expect(logger.out.join("\n")).toContain("Usage: devguard");
  });

  it.each([
    [["bogus"], "unknown command 'bogus'"],
    [["--bogus"], "unknown option '--bogus'"],
    [["status", "--bogus"], "unknown option '--bogus'"],
    [["status", "extra"], "too many arguments"],
  ])("usage error %j exits 2 and says why", async (argv, message) => {
    const logger = recordingLogger();
    expect(await runCli(argv, cliDeps({ store: untouchableStore(), logger }))).toBe(2);
    expect(logger.err.join("\n")).toContain(message);
  });

  it("no command is a usage error that shows the usage text", async () => {
    const logger = recordingLogger();
    expect(await runCli([], cliDeps({ store: untouchableStore(), logger }))).toBe(2);
    expect(logger.err.join("\n")).toContain("Usage: devguard");
  });
});

describe("no command is a stub any more", () => {
  it("request-exception needs its required options (usage error, exit 2, nothing touched)", async () => {
    const logger = recordingLogger();
    expect(await runCli(["request-exception"], cliDeps({ store: untouchableStore(), logger }))).toBe(2);
    expect(logger.err.join(" ")).toContain("required option");
  });

  it("extra arguments are a usage error", async () => {
    const logger = recordingLogger();
    expect(await runCli(["sync", "extra"], cliDeps({ store: untouchableStore(), logger }))).toBe(2);
    expect(logger.err.join(" ")).toContain("too many arguments");
  });
});

describe("install / uninstall usage", () => {
  it.each([["install"], ["uninstall"]])("'%s' without a target is a usage error that changes nothing", async (command) => {
    const logger = recordingLogger();
    expect(await runCli([command], cliDeps({ store: untouchableStore(), logger }))).toBe(2);
    expect(logger.err.join(" ")).toContain("Choose where");
  });

  it.each([["install"], ["uninstall"]])("'%s' with both --global and --repo is a usage error", async (command) => {
    const logger = recordingLogger();
    expect(await runCli([command, "--global", "--repo", "/x"], cliDeps({ store: untouchableStore(), logger }))).toBe(2);
    expect(logger.err.join(" ")).toContain("Choose where");
  });
});

describe("hook pre-push is the real, hidden entry point", () => {
  it.each([
    [["hook", "pre-push", "--help", "x"]],
    [["hook", "pre-push", "-h", "x"]],
    [["hook", "pre-push", "x", "--help"]],
    [["hook", "pre-push", "--help", "--help"]],
    [["hook", "--help"]],
    [["hook", "-h"]],
  ])("%j is never a success (exit 0 would let the push through unchecked)", async (argv) => {
    const logger = recordingLogger();
    expect(await runCli(argv, cliDeps({ store: untouchableStore(), logger }))).not.toBe(0);
  });

  it("with '--' (as the wrapper passes it) dash-prefixed remote names are operands and the push IS evaluated", async () => {
    const logger = recordingLogger();
    const stdin = `refs/heads/m ${"a".repeat(40)} refs/heads/m ${"b".repeat(40)}\n`;
    const store = fakeStore({ repos: ok({ repos: [{ repoPath: "/repo", projectId: "proj-1", registeredAt: "2026-06-01T12:00:00.000Z" }] }) }, { "proj-1": ok(cachedPolicy("proj-1")) });
    const code = await runCli(["hook", "pre-push", "--", "-h", "--help"], cliDeps({ store, logger, readStdin: async () => stdin }));
    expect(code).toBe(1); // evaluated: '--help' is not an approved destination
    expect(logger.err.join("\n")).toContain("DevGuard blocked this push.");
  });

  it("without the arguments Git always passes it is a usage error (non-zero, so the push is blocked)", async () => {
    const logger = recordingLogger();
    expect(await runCli(["hook", "pre-push"], cliDeps({ store: untouchableStore(), logger }))).toBe(2);
    expect(logger.err.join(" ")).toContain("missing required argument");
  });
});

describe("status", () => {
  const enrolled = fakeStore({
    config: ok({ serverUrl: "https://devguard.example.com", deviceId: "dev-1" }),
    credentials: ok({ deviceId: "dev-1", deviceSecret: syntheticSecret() }),
  });

  it("prints a readable summary and exits 0 when healthy", async () => {
    const logger = recordingLogger();
    expect(await runCli(["status"], cliDeps({ store: enrolled, logger }))).toBe(0);
    const text = logger.out.join("\n");
    expect(text).toContain("Device: enrolled");
    expect(text).toContain("https://devguard.example.com");
    expect(text).not.toContain(syntheticSecret());
  });

  it.each([[["--json", "status"]], [["status", "--json"]]])("--json prints parseable JSON without the secret (%j)", async (argv) => {
    const logger = recordingLogger();
    expect(await runCli(argv, cliDeps({ store: enrolled, logger }))).toBe(0);
    expect(JSON.parse(logger.out.join("\n"))).toMatchObject({ enrolled: true, healthy: true, deviceId: "dev-1" });
    expect(logger.out.join("\n")).not.toContain(syntheticSecret());
  });

  it("a fresh device says it is not enrolled and exits 0", async () => {
    const logger = recordingLogger();
    expect(await runCli(["status"], cliDeps({ store: fakeStore(), logger }))).toBe(0);
    expect(logger.out.join("\n")).toContain("not enrolled");
  });

  it("flags a problem and exits 2", async () => {
    const logger = recordingLogger();
    const store = fakeStore({ credentials: fail("insecure_permissions") });
    expect(await runCli(["status"], cliDeps({ store, logger }))).toBe(2);
    expect(logger.out.join("\n")).toMatch(/REFUSED[\s\S]*Problem found/);
  });

  it("--json with a problem still prints valid JSON and exits 2", async () => {
    const logger = recordingLogger();
    expect(await runCli(["status", "--json"], cliDeps({ store: fakeStore({ credentials: fail("insecure_permissions") }), logger }))).toBe(2);
    expect(JSON.parse(logger.out.join("\n"))).toMatchObject({ healthy: false, credentials: "insecure_permissions" });
  });

  it("a typed AgentError is shown as its message with exit 2", async () => {
    const logger = recordingLogger();
    const store = { ...fakeStore(), readConfig: async () => { throw new AgentError("config_invalid", "Config looks wrong."); } };
    expect(await runCli(["status"], cliDeps({ store, logger }))).toBe(2);
    expect(logger.err).toEqual(["Config looks wrong."]);
  });

  it("an unexpected failure gives a generic message, exit 2, and no details", async () => {
    const logger = recordingLogger();
    const store = { ...fakeStore(), readConfig: async () => { throw new Error("secret detail " + syntheticSecret()); } };
    expect(await runCli(["status"], cliDeps({ store, logger }))).toBe(2);
    expect(logger.err.join(" ")).toContain("Unexpected error");
    expect(logger.err.join(" ")).not.toContain(syntheticSecret());
  });
});
