import { join } from "node:path";

/** The managed hooks directory for a global install. */
export const globalHooksDir = (stateDir: string): string => join(stateDir, "hooks");

export const PRE_PUSH = "pre-push";
export const ORIGINAL_SUFFIX = ".devguard-orig";
