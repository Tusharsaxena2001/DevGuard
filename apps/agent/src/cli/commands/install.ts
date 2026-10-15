import type { Command } from "commander";
import { AgentError } from "../../errors.js";
import { formatGlobalInstall, formatGlobalUninstall, formatRepoInstall, formatRepoUninstall } from "../../presentation/hooks.js";
import { installGlobal, installRepo } from "../../use-cases/install-hooks.js";
import { uninstallGlobal, uninstallRepo } from "../../use-cases/uninstall-hooks.js";
import type { CliDeps } from "../deps.js";

interface Options {
  global?: boolean;
  repo?: string;
}

function target(options: Options): { kind: "global" } | { kind: "repo"; path: string } {
  if (options.global === true && options.repo === undefined) return { kind: "global" };
  if (options.repo !== undefined && options.global !== true) return { kind: "repo", path: options.repo };
  throw new AgentError("usage_error", "Choose where: --global (every repository) or --repo <path> (one repository).");
}

function print(deps: CliDeps, command: Command, lines: string[], result: unknown): void {
  if (command.optsWithGlobals<{ json?: boolean }>().json) deps.logger.info(JSON.stringify(result, null, 2));
  else for (const line of lines) deps.logger.info(line);
}

export function registerInstall(program: Command, deps: CliDeps): void {
  program
    .command("install")
    .description("Install the managed Git pre-push hook")
    .option("--global", "for every repository (sets global core.hooksPath)")
    .option("--repo <path>", "for one repository only")
    .action(async (options: Options, command: Command) => {
      const where = target(options);
      if (where.kind === "global") {
        const result = await installGlobal(deps, deps.userHome);
        print(deps, command, formatGlobalInstall(result), result);
      } else {
        const result = await installRepo(deps, where.path);
        print(deps, command, formatRepoInstall(result), result);
      }
    });

  program
    .command("uninstall")
    .description("Remove the managed Git pre-push hook and restore your previous Git setup")
    .option("--global", "remove the global hook")
    .option("--repo <path>", "remove the hook from one repository")
    .action(async (options: Options, command: Command) => {
      const where = target(options);
      if (where.kind === "global") {
        const result = await uninstallGlobal(deps);
        print(deps, command, formatGlobalUninstall(result), result);
      } else {
        const result = await uninstallRepo(deps, where.path);
        print(deps, command, formatRepoUninstall(result), result);
      }
    });
}
