import "reflect-metadata";
import { createApp } from "./bootstrap.js";
import { parseEnv } from "./config/env.js";

async function main(): Promise<void> {
  const result = parseEnv(process.env);
  if (!result.ok) {
    // Variable names and issue codes only: values (JWT_SECRET, DATABASE_URL) are never printed.
    process.stderr.write(`Invalid configuration:\n${result.problems.map((p) => `  - ${p}`).join("\n")}\n`);
    process.exit(1);
  }
  const app = await createApp(result.env);
  app.enableShutdownHooks();
  await app.listen(result.env.API_PORT);
}

main().catch((error: unknown) => {
  process.stderr.write(`DevGuard API failed to start: ${error instanceof Error ? error.name : "unknown error"}\n`);
  process.exit(1);
});
