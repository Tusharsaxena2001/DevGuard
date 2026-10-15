import { defineConfig } from "vitest/config";

// One shared test database, so test files run one at a time.
export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
