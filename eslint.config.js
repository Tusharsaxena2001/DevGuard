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
  group: ["**/apps/api/**", "**/apps/dashboard/**", "@devguard/api", "@devguard/dashboard", "**/../api/**", "**/../dashboard/**"],
  message: "Apps never import other apps; share code through packages/.",
};
const noDynamicImport = {
  selector: "ImportExpression",
  message: "Dynamic import() would bypass the layer rules; use a static import.",
};

/** Layer boundaries for apps/agent (docs/architecture/engineering-standards.md). `main.ts` is the composition root. */
const agentLayer = (folder, patterns) => ({
  files: [`apps/agent/src/${folder}/**/*.ts`],
  rules: {
    "no-restricted-imports": ["error", { patterns: [noOtherApps, ...patterns] }],
    "no-restricted-syntax": ["error", noDynamicImport],
  },
});

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description" }],
    },
  },
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
