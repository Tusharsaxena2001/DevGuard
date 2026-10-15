import { CommanderError } from "commander";
import { AgentError } from "../errors.js";
import { ExitCode } from "../exit-codes.js";
import type { CliDeps } from "./deps.js";
import { createProgram } from "./program.js";

/** Parse `argv` (without node and script), run the command and return the process exit code. Never throws. */
export async function runCli(argv: readonly string[], deps: Omit<CliDeps, "setExitCode">): Promise<number> {
  let exitCode: number = ExitCode.ok;
  const program = createProgram({ ...deps, setExitCode: (code) => void (exitCode = code) }, deps.logger);

  try {
    await program.parseAsync([...argv], { from: "user" });
    return exitCode;
  } catch (error) {
    // Commander already printed its own message; help and version are successful exits.
    if (error instanceof CommanderError) {
      // Exit 0 from the hook entry point would let the push through: help there is never a success.
      return error.exitCode === 0 && argv[0] !== "hook" ? ExitCode.ok : ExitCode.usageOrConfig;
    }
    if (error instanceof AgentError) deps.logger.error(error.message);
    else deps.logger.error("Unexpected error. Run again, and report it if it persists.");
    return ExitCode.usageOrConfig;
  }
}
