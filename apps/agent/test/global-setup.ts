import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** The end-to-end tests run the real hook, which runs the compiled agent. Build it once before the suite starts. */
export default function setup(): void {
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], { cwd, stdio: "pipe" });
}
