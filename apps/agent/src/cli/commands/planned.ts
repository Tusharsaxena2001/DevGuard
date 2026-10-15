import type { Command } from "commander";
import { ExitCode } from "../../exit-codes.js";
import type { CliDeps } from "../deps.js";

/** Commands whose behaviour arrives in later modules. They fail loudly (exit 2) rather than pretend to work. */
const PLANNED: readonly { name: string; description: string }[] = [
  { name: "enroll", description: "Enroll this device with the DevGuard server" },
  { name: "request-exception", description: "Request an exception for a blocked push" },
  { name: "sync", description: "Refresh project policies from the server" },
];

function unavailable(deps: CliDeps, name: string): void {
  deps.logger.error(`'devguard ${name}' is not available in this build yet.`);
  deps.setExitCode(ExitCode.usageOrConfig);
}

export function registerPlanned(program: Command, deps: CliDeps): void {
  for (const { name, description } of PLANNED) {
    program
      .command(name)
      .description(`${description} (not available yet)`)
      .allowUnknownOption()
      .allowExcessArguments()
      .action(() => unavailable(deps, name));
  }
}
