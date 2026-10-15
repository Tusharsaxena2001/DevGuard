import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Every test file runs against a private sandbox, so no test can ever touch the developer's real ~/.config/devguard.
const sandbox = mkdtempSync(join(tmpdir(), "devguard-sandbox-"));
process.env["HOME"] = sandbox;
process.env["DEVGUARD_HOME"] = join(sandbox, "state");
// Git must never read or write the developer's real configuration or be affected by system config.
process.env["XDG_CONFIG_HOME"] = join(sandbox, "xdg");
process.env["GIT_CONFIG_GLOBAL"] = join(sandbox, "gitconfig");
process.env["GIT_CONFIG_NOSYSTEM"] = "1";
process.env["GIT_TERMINAL_PROMPT"] = "0";
for (const [key, value] of Object.entries({ NAME: "Test", EMAIL: "test@example.com" })) {
  process.env[`GIT_AUTHOR_${key}`] = value;
  process.env[`GIT_COMMITTER_${key}`] = value;
}

afterAll(() => rmSync(sandbox, { recursive: true, force: true }));
