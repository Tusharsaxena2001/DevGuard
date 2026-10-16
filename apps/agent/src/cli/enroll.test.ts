import { describe, expect, it } from "vitest";
import { fail, ok } from "../result.js";
import { cliDeps, fakeApi, fakeStore, recordingLogger, syntheticSecret } from "../../test/support/fakes.js";
import type { AgentConfig } from "../ports/local-state.js";
import { runCli } from "./run.js";

const SERVER = "https://devguard.example.test";
const TOKEN = ["dgt", "synthetic", "Token123"].join("_");

function setup(api = fakeApi({ enroll: ok({ deviceId: "dev-1", deviceSecret: syntheticSecret() }) }), stdin = "") {
  const logger = recordingLogger();
  const writes: string[] = [];
  let config: AgentConfig | undefined;
  let credentials: { deviceId: string; deviceSecret: string } | undefined;
  const store = {
    ...fakeStore({}, {}, "/state"),
    readConfig: async () => ok(config),
    readCredentials: async () => ok(credentials),
    writeCredentials: async (c: { deviceId: string; deviceSecret: string }) => void (writes.push("credentials"), (credentials = c)),
    writeConfig: async (c: AgentConfig) => void (writes.push("config"), (config = c)),
  };
  const deps = cliDeps({ logger, api, store, readStdin: async () => stdin });
  return { logger, writes, api, deps };
}

const output = (l: ReturnType<typeof recordingLogger>): string => [...l.out, ...l.err].join("\n");

describe("devguard enroll", () => {
  it("enrols with --token, prints a summary and never prints the token or the secret", async () => {
    const { logger, deps, writes } = setup();
    expect(await runCli(["enroll", "--server", SERVER, "--token", TOKEN], deps)).toBe(0);
    expect(output(logger)).toContain("Enrolled this device");
    expect(output(logger)).toContain("dev-1");
    expect(output(logger)).not.toContain(TOKEN);
    expect(output(logger)).not.toContain(syntheticSecret());
    expect(writes).toEqual(["credentials", "config"]);
  });

  it("reads the token from standard input with --token-stdin", async () => {
    const { deps, api } = setup(undefined, `${TOKEN}\n`);
    expect(await runCli(["enroll", "--server", SERVER, "--token-stdin"], deps)).toBe(0);
    expect((api.calls[0]?.args[1] as { token: string }).token).toBe(TOKEN);
  });

  it.each([
    [["enroll", "--server", SERVER], "exactly one of"],
    [["enroll", "--server", SERVER, "--token", "t", "--token-stdin"], "exactly one of"],
    [["enroll", "--token", "t"], "required option"],
    [["enroll", "--server", "http://example.com", "--token", "t"], "https"],
  ])("%j is a usage error (exit 2)", async (argv, message) => {
    const { logger, deps, api } = setup();
    expect(await runCli(argv, deps)).toBe(2);
    expect(output(logger)).toContain(message);
    expect(api.calls).toEqual([]);
  });

  it.each([
    ["token_invalid", "invalid, expired or already used"],
    ["unreachable", "Could not reach"],
    ["rate_limited", "limiting requests"],
  ] as const)("a %s failure exits 2 with an actionable message and saves nothing", async (reason, text) => {
    const { logger, deps, writes } = setup(fakeApi({ enroll: fail(reason) }));
    expect(await runCli(["enroll", "--server", SERVER, "--token", TOKEN], deps)).toBe(2);
    expect(logger.err.join(" ")).toContain(text);
    expect(output(logger)).not.toContain(TOKEN);
    expect(writes).toEqual([]);
  });

  it("warns that the token may already be used when the answer never arrived", async () => {
    const { logger, deps } = setup(fakeApi({ enroll: fail("unreachable") }));
    await runCli(["enroll", "--server", SERVER, "--token", TOKEN], deps);
    expect(logger.err.join(" ")).toContain("token is now used");
  });

  it("--json prints machine-readable output without credentials", async () => {
    const { logger, deps } = setup();
    expect(await runCli(["--json", "enroll", "--server", SERVER, "--token", TOKEN], deps)).toBe(0);
    expect(JSON.parse(logger.out.join(""))).toEqual({ enrolled: true, deviceId: "dev-1", serverUrl: SERVER, hookInstalled: true, sync: "failed" });
  });
});

describe("devguard status --check-server", () => {
  const config: AgentConfig = { serverUrl: SERVER, deviceId: "dev-1", lastContactAt: "2026-05-30T08:00:00.000Z" };
  const credentials = { deviceId: "dev-1", deviceSecret: syntheticSecret() };
  const enrolled = (api: ReturnType<typeof fakeApi>) => {
    const logger = recordingLogger();
    return { logger, deps: cliDeps({ logger, api, store: fakeStore({ config: ok(config), credentials: ok(credentials) }) }) };
  };

  it("shows the last server contact from local state without any network call", async () => {
    const api = fakeApi();
    const { logger, deps } = enrolled(api);
    await runCli(["status"], deps);
    expect(logger.out.join("\n")).toContain("Last server contact: 2026-05-30T08:00:00.000Z");
    expect(api.calls).toEqual([]);
  });

  it("confirms a reachable server", async () => {
    const { logger, deps } = enrolled(fakeApi({ heartbeat: ok(undefined) }));
    expect(await runCli(["status", "--check-server"], deps)).toBe(0);
    expect(logger.out.join("\n")).toContain("Server check: reachable");
  });

  it.each([
    ["revoked", "has been revoked"],
    ["unauthorized", "did not accept this device"],
    ["unreachable", "Could not reach"],
  ] as const)("reports %s and exits 2", async (reason, text) => {
    const { logger, deps } = enrolled(fakeApi({ heartbeat: fail(reason) }));
    expect(await runCli(["status", "--check-server"], deps)).toBe(2);
    expect(logger.out.join("\n")).toContain(text);
    expect(output(logger)).not.toContain(syntheticSecret());
  });

  it("includes the check in --json output", async () => {
    const { logger, deps } = enrolled(fakeApi({ heartbeat: fail("revoked") }));
    await runCli(["--json", "status", "--check-server"], deps);
    expect(JSON.parse(logger.out.join("")).serverCheck).toEqual({ state: "failed", reason: "revoked" });
  });

  it("says it did not check when the device is not enrolled", async () => {
    const logger = recordingLogger();
    const api = fakeApi();
    expect(await runCli(["status", "--check-server"], cliDeps({ logger, api }))).toBe(0);
    expect(logger.out.join("\n")).toContain("not enrolled");
    expect(api.calls).toEqual([]);
  });
});
