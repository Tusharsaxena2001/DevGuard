import type { Command } from "commander";
import { ExitCode } from "../../exit-codes.js";
import { formatServerCheck } from "../../presentation/enroll.js";
import { formatHookStatusText } from "../../presentation/hooks.js";
import { formatRepoProtection, formatStatusJson, formatStatusText } from "../../presentation/status.js";
import { checkServer, type ServerCheck } from "../../use-cases/check-server.js";
import { getFullStatus } from "../../use-cases/get-full-status.js";
import type { CliDeps } from "../deps.js";

export function registerStatus(program: Command, deps: CliDeps): void {
  program
    .command("status")
    .description("Show this device's local DevGuard state and hook status")
    .option("--check-server", "also ask the server whether it accepts this device (a heartbeat)")
    .action(async (options: { checkServer?: boolean }, command: Command) => {
      const report = await getFullStatus(deps, deps.cwd(), { now: deps.clock.now(), maxStaleMinutes: deps.policyMaxStaleMinutes });
      const server: ServerCheck | undefined = options.checkServer === true ? await checkServer(deps) : undefined;
      if (command.optsWithGlobals<{ json?: boolean }>().json) deps.logger.info(formatStatusJson(report, server));
      else {
        const text = formatStatusText(report);
        const closing = report.healthy ? [] : text.slice(-1).filter((l) => l.startsWith("Problem found"));
        for (const line of closing.length > 0 ? text.slice(0, -1) : text) deps.logger.info(line);
        for (const line of formatHookStatusText(report.hooks)) deps.logger.info(line);
        for (const line of formatRepoProtection(report.repository)) deps.logger.info(line);
        if (server) deps.logger.info(formatServerCheck(server));
        if (!report.healthy) deps.logger.info("Problem found: see the entries marked above.");
      }
      const serverOk = server === undefined || server.state === "reachable" || server.state === "not_enrolled";
      deps.setExitCode(report.healthy && serverOk ? ExitCode.ok : ExitCode.usageOrConfig);
    });
}
