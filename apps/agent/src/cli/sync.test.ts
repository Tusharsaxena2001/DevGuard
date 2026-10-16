import { describe, expect, it } from "vitest";
import { fail, ok } from "../result.js";
import { cliDeps, fakeApi, fakeStore, project, recordingLogger, syntheticSecret } from "../../test/support/fakes.js";
import type { ApiResult, ProjectsReply } from "../ports/api-client.js";
import type { AgentConfig } from "../ports/local-state.js";
import { runCli } from "./run.js";

const config: AgentConfig = { serverUrl: "https://devguard.example.test", deviceId: "dev-1" };
const credentials = { deviceId: "dev-1", deviceSecret: syntheticSecret() };

function setup(getProjects: ApiResult<ProjectsReply>) {
  const logger = recordingLogger();
  const written: string[] = [];
  const store = { ...fakeStore({ config: ok(config), credentials: ok(credentials) }), writePolicy: async (p: { project: { projectId: string } }) => void written.push(p.project.projectId) };
  return { logger, written, deps: cliDeps({ logger, store, api: fakeApi({ getProjects }) }) };
}

describe("devguard sync", () => {
  it("reports what it synced and exits 0", async () => {
    const { logger, deps, written } = setup(ok({ notModified: false, sync: { projects: [project("proj-1"), project("proj-2")], syncedAt: "2026-06-01T12:00:00.000Z" }, etag: '"e"' }));
    expect(await runCli(["sync"], deps)).toBe(0);
    expect(logger.out.join("\n")).toContain("Synced 2 project(s)");
    expect(written).toEqual(["proj-1", "proj-2"]);
  });

  it("says when nothing changed", async () => {
    const { logger, deps } = setup(ok({ notModified: true }));
    expect(await runCli(["sync"], deps)).toBe(0);
    expect(logger.out.join("\n")).toContain("Already up to date");
  });

  it.each([
    ["unreachable", "Could not reach"],
    ["revoked", "has been revoked"],
    ["unauthorized", "did not accept"],
  ] as const)("a %s failure exits 2 with an actionable message", async (reason, text) => {
    const { logger, deps } = setup(fail(reason));
    expect(await runCli(["sync"], deps)).toBe(2);
    expect(logger.err.join(" ")).toContain(text);
    expect(logger.err.join(" ")).not.toContain(credentials.deviceSecret);
  });

  it("tells an unenrolled device how to enroll, and exits 2", async () => {
    const logger = recordingLogger();
    expect(await runCli(["sync"], cliDeps({ logger }))).toBe(2);
    expect(logger.out.join("\n")).toContain("not enrolled");
  });

  it("--json prints the outcome without credentials", async () => {
    const { logger, deps } = setup(ok({ notModified: true }));
    await runCli(["--json", "sync"], deps);
    expect(JSON.parse(logger.out.join(""))).toEqual({ state: "unchanged", projects: 0, events: { state: "nothing_pending" } });
  });
});
