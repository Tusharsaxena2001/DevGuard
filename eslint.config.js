import tseslint from "typescript-eslint";

const noAdapters = { group: ["**/adapters/**"], message: "Only main.ts (the composition root) may import adapters; depend on a port." };
const noCli = { group: ["**/cli/**"], message: "Only main.ts may import the CLI layer." };
const noUseCases = { group: ["**/use-cases/**"], message: "Adapters implement ports; they must not call use cases." };
const noCommander = { group: ["commander"], message: "Argument parsing belongs in cli/ only." };
const noIo = {
  group: ["node:fs", "node:fs/*", "node:child_process", "node:net", "node:http", "node:https", "fs", "fs/*", "child_process"],
  message: "I/O belongs in adapters/ behind a port.",
};
const noOtherApps = {
  group: ["**/apps/api/**", "**/apps/dashboard/**", "**/apps/agent/**", "@devguard/api", "@devguard/dashboard", "@devguard/agent", "**/../api/**", "**/../dashboard/**", "**/../agent/**"],
  message: "Apps never import other apps; share code through packages/.",
};
const noDynamicImport = {
  selector: "ImportExpression",
  message: "Dynamic import() would bypass the layer rules; use a static import.",
};

const noPrisma = {
  group: ["@prisma/client", "@prisma/client/*", "@prisma/adapter-pg", "**/prisma/generated/**", "**/prisma/prisma.service*"],
  message: "Prisma is used only in *.repository.ts (and src/prisma). Map to shared DTOs before leaving the repository.",
};
const noRepository = { group: ["**/*.repository", "**/*.repository.js"], message: "Controllers call services, never repositories." };
const noOtherModuleRepository = {
  group: ["../**/*.repository", "../**/*.repository.js"],
  message: "Services call other modules' services, never their repositories (own repository: ./x.repository.js).",
};

/** Layer boundaries for apps/api (docs/architecture/engineering-standards.md). Test files and prisma/ (seed) are exempt. */
const apiFiles = (files, patterns) => ({
  files,
  rules: { "no-restricted-imports": ["error", { patterns: [noOtherApps, ...patterns] }] },
});

/** Layer boundaries for apps/agent (docs/architecture/engineering-standards.md). `main.ts` is the composition root. */
const agentLayer = (folder, patterns) => ({
  files: [`apps/agent/src/${folder}/**/*.ts`],
  rules: {
    "no-restricted-imports": ["error", { patterns: [noOtherApps, ...patterns] }],
    "no-restricted-syntax": ["error", noDynamicImport],
  },
});

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/prisma/generated/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description" }],
    },
  },
  apiFiles(["apps/api/src/**/*.ts"], [noPrisma]),
  apiFiles(["apps/api/src/**/*.controller.ts"], [noPrisma, noRepository]),
  apiFiles(["apps/api/src/**/*.service.ts"], [noPrisma, noOtherModuleRepository]),
  // Repositories and the Prisma wiring are the only places allowed to touch the client.
  apiFiles(["apps/api/src/**/*.repository.ts", "apps/api/src/prisma/**/*.ts", "apps/api/src/**/*.test.ts"], []),
  agentLayer("cli", [noAdapters, noIo]),
  agentLayer("use-cases", [noAdapters, noCli, noCommander, noIo]),
  agentLayer("ports", [noAdapters, noCli, noCommander, noIo]),
  agentLayer("presentation", [noAdapters, noCli, noCommander, noIo]),
  agentLayer("adapters", [noCli, noUseCases, noCommander]),
  // Files directly under src/ (main.ts, errors.ts, ...): only the app-to-app rule applies.
  {
    files: ["apps/agent/src/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [noOtherApps] }] },
  },
  // packages/* never depend on apps/*, and shared never on policy-engine (dependency direction).
  {
    files: ["packages/**/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["**/apps/**", "@devguard/agent", "@devguard/api", "@devguard/dashboard"], message: "packages/* never import apps/*." }] },
      ],
    },
  },
  {
    files: ["packages/shared/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/apps/**", "@devguard/agent", "@devguard/api", "@devguard/dashboard", "@devguard/policy-engine"], message: "shared is the bottom layer: it imports no other DevGuard package." },
          ],
        },
      ],
    },
  },
);
