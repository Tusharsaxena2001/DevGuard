import { Command } from "commander";
import type { Logger } from "../ports/logger.js";
import { registerHook } from "./commands/hook.js";
import { registerInstall } from "./commands/install.js";
import { registerRegister } from "./commands/register.js";
import { registerPlanned } from "./commands/planned.js";
import { registerStatus } from "./commands/status.js";
import type { CliDeps } from "./deps.js";

/** Build the command tree. Settings are applied before commands are added so every subcommand inherits them. */
export function createProgram(deps: CliDeps, logger: Logger): Command {
  const program = new Command()
    .name("devguard")
    .description("Developer security guardrail for company-managed laptops")
    .option("--json", "machine-readable output where supported")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => logger.info(text.replace(/\n$/, "")),
      writeErr: (text) => logger.error(text.replace(/\n$/, "")),
    });

  registerStatus(program, deps);
  registerInstall(program, deps);
  registerRegister(program, deps);
  registerHook(program, deps);
  registerPlanned(program, deps);
  return program;
}
