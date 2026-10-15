import { isAbsolute, join } from "node:path";
import { fail, ok, type Result } from "../../result.js";

export type HomeReason = "relative_home";

/**
 * Where agent state lives: `$DEVGUARD_HOME` (used by tests) or `~/.config/devguard`. A relative override is
 * rejected: it would silently resolve against whatever directory the command runs in.
 */
export function resolveDevGuardHome(env: Readonly<Record<string, string | undefined>>, homeDir: string): Result<string, HomeReason> {
  const override = env["DEVGUARD_HOME"];
  if (override === undefined || override === "") return ok(join(homeDir, ".config", "devguard"));
  return isAbsolute(override) ? ok(override) : fail("relative_home");
}
