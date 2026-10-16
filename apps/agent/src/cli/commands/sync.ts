import type { Command } from "commander";
import { ExitCode } from "../../exit-codes.js";
import { FAILURE_TEXT } from "../../presentation/enroll.js";
import { formatDelivery, formatSync } from "../../presentation/sync.js";
import { deliverEvents } from "../../use-cases/deliver-events.js";
import { syncProjects } from "../../use-cases/sync-projects.js";
import type { CliDeps } from "../deps.js";

export function registerSync(program: Command, deps: CliDeps): void {
  program
    .command("sync")
    .description("Refresh the project policies assigned to you from the DevGuard server")
    .action(async (_options: unknown, command: Command) => {
      const outcome = await syncProjects(deps);
      // Retry anything that could not be delivered earlier ("retry on the next command").
      const delivery = outcome.state === "updated" || outcome.state === "unchanged" ? await deliverEvents(deps).catch(() => undefined) : undefined;
      if (command.optsWithGlobals<{ json?: boolean }>().json) deps.logger.info(JSON.stringify(delivery === undefined ? outcome : { ...outcome, events: delivery }, null, 2));
      else if (outcome.state === "failed") deps.logger.error(FAILURE_TEXT[outcome.reason]);
      else {
        for (const line of formatSync(outcome)) deps.logger.info(line);
        if (delivery !== undefined) for (const line of formatDelivery(delivery)) deps.logger.info(line);
      }
      const success = outcome.state === "updated" || outcome.state === "unchanged";
      deps.setExitCode(success ? ExitCode.ok : ExitCode.usageOrConfig);
    });
}
