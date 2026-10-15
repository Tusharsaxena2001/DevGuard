import type { Command } from "commander";
import { ExitCode } from "../../exit-codes.js";
import { formatHookStatusText } from "../../presentation/hooks.js";
import { formatRepoProtection, formatStatusJson, formatStatusText } from "../../presentation/status.js";
import { getFullStatus } from "../../use-cases/get-full-status.js";
import type { CliDeps } from "../deps.js";

export function registerStatus(program: Command, deps: CliDeps): void {
  program
    .command("status")
    .description("Show this device's local DevGuard state and hook status")
    .action(async (_options: unknown, command: Command) => {
      const report = await getFullStatus(deps, deps.cwd());
      if (command.optsWithGlobals<{ json?: boolean }>().json) deps.logger.info(formatStatusJson(report));
      else {
        const text = formatStatusText(report);
        const closing = report.healthy ? [] : text.slice(-1).filter((l) => l.startsWith("Problem found"));
        for (const line of closing.length > 0 ? text.slice(0, -1) : text) deps.logger.info(line);
        for (const line of formatHookStatusText(report.hooks)) deps.logger.info(line);
        for (const line of formatRepoProtection(report.repository)) deps.logger.info(line);
        if (!report.healthy) deps.logger.info("Problem found: see the entries marked above.");
      }
      deps.setExitCode(report.healthy ? ExitCode.ok : ExitCode.usageOrConfig);
    });
}
