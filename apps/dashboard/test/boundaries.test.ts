// @vitest-environment node
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/** The layering rules are enforced by ESLint (eslint.config.js at the repo root); these tests prove they fire. */
const dir = fileURLToPath(new URL("..", import.meta.url));
const eslint = new ESLint({ cwd: dir });
const RULES = new Set(["no-restricted-imports", "no-restricted-globals"]);

async function violations(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId && RULES.has(m.ruleId)).map((m) => m.message);
}

describe("dashboard layer boundaries", () => {
  it.each([
    ["a page calls fetch", "src/features/events/pages/EventsPage.tsx", 'export const load = () => fetch("/v1/events");'],
    ["a component calls fetch", "src/shared/ui/Thing.tsx", 'export const load = () => fetch("/v1/events");'],
    ["the app shell calls fetch", "src/app/App.tsx", 'export const load = () => fetch("/v1/events");'],
    ["a feature imports another feature", "src/features/events/pages/EventsPage.tsx", 'import { useProjects } from "../../projects/api/projects.js";'],
    ["a feature imports another feature's page", "src/features/audit/pages/AuditPage.tsx", 'import { OverviewPage } from "../../overview/pages/OverviewPage.js";'],
    ["a feature imports the policy engine", "src/features/events/api/events.ts", 'import { isApproved } from "@devguard/policy-engine";'],
    ["shared UI imports the policy engine", "src/shared/ui/Thing.tsx", 'import { isApproved } from "@devguard/policy-engine";'],
    ["the dashboard imports the API app", "src/app/App.tsx", 'import { thing } from "@devguard/api";'],
    ["the dashboard imports the agent by path", "src/app/App.tsx", 'import { thing } from "../../../agent/src/thing.js";'],
  ])("rejects: %s", async (_name, filePath, code) => {
    expect((await violations(filePath, code)).length).toBeGreaterThan(0);
  });

  it.each([
    ["the API client calls fetch", "src/shared/lib/api-client.ts", 'export const load = () => fetch("/v1/x");'],
    ["a feature uses shared code and shared contracts", "src/features/events/pages/EventsPage.tsx", 'import { PageHeader } from "../../../shared/ui/PageHeader.js";\nimport { OutcomeSchema } from "@devguard/shared";'],
    ["a feature imports its own api hooks", "src/features/events/pages/EventsPage.tsx", 'import { useEvents } from "../api/events.js";'],
    ["the app composes features", "src/app/App.tsx", 'import { EventsPage } from "../features/events/pages/EventsPage.js";'],
  ])("allows: %s", async (_name, filePath, code) => {
    expect(await violations(filePath, code)).toEqual([]);
  });

  it("the real source tree has no violations", async () => {
    const results = await eslint.lintFiles(["src/**/*.{ts,tsx}"]);
    const bad = results.flatMap((r) => r.messages.filter((m) => m.ruleId && RULES.has(m.ruleId)).map(() => r.filePath));
    expect(bad).toEqual([]);
  });
});
