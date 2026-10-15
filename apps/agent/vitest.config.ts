import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["./test/setup.ts"], globalSetup: ["./test/global-setup.ts"], testTimeout: 30_000 },
});
