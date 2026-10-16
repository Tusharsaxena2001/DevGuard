import type { Command } from "commander";
import { ExitCode } from "../../exit-codes.js";
import { FAILURE_TEXT } from "../../presentation/enroll.js";
import { formatExceptionStatus, formatNeedsProject, formatRequested } from "../../presentation/exceptions.js";
import { exceptionStatus, requestException } from "../../use-cases/request-exception.js";
import type { CliDeps } from "../deps.js";

const NOT_ENROLLED = "This device is not enrolled. Run 'devguard enroll --server <url> --token-stdin' first.";
const UNUSABLE = "DevGuard's local files are unusable. Run 'devguard status' to see what to fix.";
const REJECTED_HINT = "The server refused the request. Common reasons: you are not assigned to that project, or you already have a pending request for that destination.";

export function registerExceptions(program: Command, deps: CliDeps): void {
  program
    .command("request-exception")
    .description("Ask an administrator to allow a push to a destination that DevGuard blocked")
    .requiredOption("--destination <url>", "the repository you need to push to")
    .requiredOption("--reason <text>", "why you need it (at least 10 characters)")
    .option("--project <id>", "the project (default: the one the current repository belongs to)")
    .action(async (options: { destination: string; reason: string; project?: string }, command: Command) => {
      const outcome = await requestException(
        { store: deps.store, git: deps.git, api: deps.api },
        { destination: options.destination, reason: options.reason, projectId: options.project, cwd: deps.cwd() },
      );
      const json = command.optsWithGlobals<{ json?: boolean }>().json === true;
      switch (outcome.state) {
        case "requested":
          if (json) deps.logger.info(JSON.stringify({ requested: true, id: outcome.entry.id, status: outcome.entry.status }, null, 2));
          else for (const line of formatRequested(outcome)) deps.logger.info(line);
          return;
        case "needs_project":
          for (const line of formatNeedsProject(outcome)) deps.logger.error(line);
          break;
        case "not_enrolled":
          deps.logger.error(NOT_ENROLLED);
          break;
        case "unusable_state":
          deps.logger.error(UNUSABLE);
          break;
        case "failed":
          deps.logger.error(outcome.reason === "rejected" ? REJECTED_HINT : FAILURE_TEXT[outcome.reason]);
          break;
      }
      deps.setExitCode(ExitCode.usageOrConfig);
    });

  program
    .command("exception")
    .description("Exception requests")
    .command("status [id]")
    .description("Show your exception requests and what became of them")
    .action(async (id: string | undefined, _options: unknown, command: Command) => {
      const outcome = await exceptionStatus({ store: deps.store, api: deps.api }, id);
      const json = command.optsWithGlobals<{ json?: boolean }>().json === true;
      if (outcome.state === "list" || outcome.state === "one") {
        if (json) deps.logger.info(JSON.stringify(outcome.state === "list" ? outcome.page : outcome.entry, null, 2));
        else for (const line of formatExceptionStatus(outcome)) deps.logger.info(line);
        return;
      }
      deps.logger.error(outcome.state === "failed" ? (outcome.reason === "rejected" ? "The server does not know that request." : FAILURE_TEXT[outcome.reason]) : outcome.state === "not_enrolled" ? NOT_ENROLLED : UNUSABLE);
      deps.setExitCode(ExitCode.usageOrConfig);
    });
}
