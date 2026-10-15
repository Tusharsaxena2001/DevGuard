import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/** The layering rules are enforced by ESLint (eslint.config.js at the repo root); these tests prove they fire. */
const agentDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = fileURLToPath(new URL("../../..", import.meta.url));
const fromAgent = new ESLint({ cwd: agentDir });
const fromRepo = new ESLint({ cwd: repoDir });

const BOUNDARY_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);

async function violations(eslint: ESLint, filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId && BOUNDARY_RULES.has(m.ruleId)).map((m) => m.message);
}

describe("agent layer boundaries", () => {
  it.each([
    ["cli imports an adapter", "src/cli/x.ts", 'import { createFsConfigStore } from "../adapters/fs-store/fs-config-store.js";'],
    ["cli imports node:fs", "src/cli/x.ts", 'import { readFile } from "node:fs/promises";'],
    ["use case imports an adapter", "src/use-cases/x.ts", 'import { createConsoleLogger } from "../adapters/console-logger.js";'],
    ["use case imports the cli", "src/use-cases/x.ts", 'import { runCli } from "../cli/run.js";'],
    ["use case imports commander", "src/use-cases/x.ts", 'import { Command } from "commander";'],
    ["use case imports node:fs", "src/use-cases/x.ts", 'import { readFileSync } from "node:fs";'],
    ["use case imports child_process (Git only via GitPort)", "src/use-cases/x.ts", 'import { execFile } from "node:child_process";'],
    ["use case uses dynamic import to dodge the rules", "src/use-cases/x.ts", 'export const load = () => import("../adapters/console-logger.js");'],
    ["port imports an adapter", "src/ports/x.ts", 'import { createConsoleLogger } from "../adapters/console-logger.js";'],
    ["port imports commander", "src/ports/x.ts", 'import { Command } from "commander";'],
    ["presentation imports an adapter", "src/presentation/x.ts", 'import { createConsoleLogger } from "../adapters/console-logger.js";'],
    ["presentation imports node:fs", "src/presentation/x.ts", 'import { readFileSync } from "node:fs";'],
    ["adapter imports a use case", "src/adapters/x.ts", 'import { getStatus } from "../use-cases/get-status.js";'],
    ["adapter imports the cli", "src/adapters/fs-store/x.ts", 'import { runCli } from "../../cli/run.js";'],
    ["adapter imports commander", "src/adapters/x.ts", 'import { Command } from "commander";'],
    ["cli imports another app by path", "src/cli/x.ts", 'import { thing } from "../../../api/src/thing.js";'],
    ["cli imports another app by package name", "src/cli/x.ts", 'import { thing } from "@devguard/api";'],
    ["main.ts imports the dashboard app", "src/main.ts", 'import { thing } from "@devguard/dashboard";'],
  ])("rejects: %s", async (_name, filePath, code) => {
    expect(await violations(fromAgent, filePath, code)).toHaveLength(1);
  });

  it.each([
    ["cli uses commander, a use case and a port", "src/cli/x.ts", 'import { Command } from "commander";\nimport { getStatus } from "../use-cases/get-status.js";\nimport type { Logger } from "../ports/logger.js";'],
    ["use case uses a port and the shared package", "src/use-cases/x.ts", 'import type { ConfigStore } from "../ports/config-store.js";\nimport { ErrorCode } from "@devguard/shared";'],
    ["presentation uses a use-case type", "src/presentation/x.ts", 'import type { StatusReport } from "../use-cases/get-status.js";'],
    ["adapter implements a port and uses node I/O", "src/adapters/x.ts", 'import { readFile } from "node:fs/promises";\nimport type { Logger } from "../ports/logger.js";'],
    ["main.ts composes everything", "src/main.ts", 'import { createFsConfigStore } from "./adapters/fs-store/fs-config-store.js";\nimport { runCli } from "./cli/run.js";'],
  ])("allows: %s", async (_name, filePath, code) => {
    expect(await violations(fromAgent, filePath, code)).toEqual([]);
  });

  it("the real source tree has no violations", async () => {
    const results = await fromAgent.lintFiles(["src/**/*.ts"]);
    const bad = results.flatMap((r) => r.messages.filter((m) => m.ruleId && BOUNDARY_RULES.has(m.ruleId)).map(() => r.filePath));
    expect(bad).toEqual([]);
  });
});

describe("package dependency direction", () => {
  it.each([
    ["policy-engine imports an app", "packages/policy-engine/src/x.ts", 'import { thing } from "@devguard/agent";'],
    ["shared imports policy-engine", "packages/shared/src/x.ts", 'import { isApproved } from "@devguard/policy-engine";'],
    ["shared imports an app by path", "packages/shared/src/x.ts", 'import { thing } from "../../../apps/api/src/x.js";'],
  ])("rejects: %s", async (_name, filePath, code) => {
    expect(await violations(fromRepo, filePath, code)).toHaveLength(1);
  });

  it("allows policy-engine to import shared", async () => {
    expect(await violations(fromRepo, "packages/policy-engine/src/x.ts", 'import type { Finding } from "@devguard/shared";')).toEqual([]);
  });
});
