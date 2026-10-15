import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/** The layering rules are enforced by ESLint (eslint.config.js at the repo root); these tests prove they fire. */
const apiDir = fileURLToPath(new URL("..", import.meta.url));
const eslint = new ESLint({ cwd: apiDir });
const BOUNDARY_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);

async function violations(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId && BOUNDARY_RULES.has(m.ruleId)).map((m) => m.message);
}

describe("api layer boundaries", () => {
  it.each([
    ["controller imports @prisma/client", "src/modules/x/x.controller.ts", 'import { PrismaClient } from "@prisma/client";'],
    ["controller imports the generated client", "src/modules/x/x.controller.ts", 'import { Role } from "../../prisma/generated/enums.js";'],
    ["controller imports PrismaService", "src/modules/x/x.controller.ts", 'import { PrismaService } from "../../prisma/prisma.service.js";'],
    ["controller imports a repository", "src/modules/x/x.controller.ts", 'import { XRepository } from "./x.repository.js";'],
    ["service imports the generated client", "src/modules/x/x.service.ts", 'import { PrismaClient } from "../../prisma/generated/client.js";'],
    ["service imports PrismaService", "src/modules/x/x.service.ts", 'import { PrismaService } from "../../prisma/prisma.service.js";'],
    ["service imports another module's repository", "src/modules/x/x.service.ts", 'import { YRepository } from "../y/y.repository.js";'],
    ["mapper imports Prisma", "src/modules/x/x.mapper.ts", 'import type { User } from "@prisma/client";'],
    ["guard imports Prisma", "src/common/guards/x.guard.ts", 'import { PrismaService } from "../../prisma/prisma.service.js";'],
    ["api imports the agent app", "src/modules/x/x.service.ts", 'import { thing } from "@devguard/agent";'],
    ["api imports the dashboard by path", "src/modules/x/x.service.ts", 'import { thing } from "../../../../dashboard/src/thing.js";'],
  ])("rejects: %s", async (_name, filePath, code) => {
    expect((await violations(filePath, code)).length).toBeGreaterThan(0);
  });

  it.each([
    ["repository uses PrismaService", "src/modules/x/x.repository.ts", 'import { PrismaService } from "../../prisma/prisma.service.js";\nimport type { Role } from "../../prisma/generated/enums.js";'],
    ["service uses its own repository", "src/modules/x/x.service.ts", 'import { XRepository } from "./x.repository.js";'],
    ["service uses another module's service", "src/modules/x/x.service.ts", 'import { YService } from "../y/y.service.js";'],
    ["controller uses a service and shared contracts", "src/modules/x/x.controller.ts", 'import { XService } from "./x.service.js";\nimport { RoleSchema } from "@devguard/shared";'],
    ["prisma module wires the service", "src/prisma/prisma.module.ts", 'import { PrismaService } from "./prisma.service.js";'],
    ["app module imports the prisma module", "src/app.module.ts", 'import { PrismaModule } from "./prisma/prisma.module.js";'],
  ])("allows: %s", async (_name, filePath, code) => {
    expect(await violations(filePath, code)).toEqual([]);
  });

  it("the real source tree has no violations", async () => {
    const results = await eslint.lintFiles(["src/**/*.ts"]);
    const bad = results.flatMap((r) => r.messages.filter((m) => m.ruleId && BOUNDARY_RULES.has(m.ruleId)).map(() => r.filePath));
    expect(bad).toEqual([]);
  });
});
