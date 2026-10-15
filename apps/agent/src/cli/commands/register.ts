import type { Command } from "commander";
import { formatRegister, formatUnregister } from "../../presentation/register.js";
import { registerRepo, unregisterRepo } from "../../use-cases/register-repo.js";
import type { CliDeps } from "../deps.js";

function print(deps: CliDeps, command: Command, lines: string[], result: unknown): void {
  if (command.optsWithGlobals<{ json?: boolean }>().json) deps.logger.info(JSON.stringify(result, null, 2));
  else for (const line of lines) deps.logger.info(line);
}

export function registerRegister(program: Command, deps: CliDeps): void {
  program
    .command("register [path]")
    .description("Manually register a repository to a project (fallback when it is not recognised automatically)")
    .option("--project <id>", "project id")
    .option("--policy-file <file>", "project policy JSON to use (local use without a server)")
    .option("--replace-policy", "overwrite a different policy already saved for that project")
    .action(async (path: string | undefined, options: { project?: string; policyFile?: string; replacePolicy?: boolean }, command: Command) => {
      const result = await registerRepo(deps, {
        path: path ?? deps.cwd(),
        ...(options.project === undefined ? {} : { projectId: options.project }),
        ...(options.policyFile === undefined ? {} : { policyFile: options.policyFile }),
        ...(options.replacePolicy === true ? { replacePolicy: true } : {}),
      });
      print(deps, command, formatRegister(result), result);
    });

  program
    .command("unregister [path]")
    .description("Remove a repository's manual registration")
    .action(async (path: string | undefined, _options: unknown, command: Command) => {
      const result = await unregisterRepo(deps, path ?? deps.cwd());
      print(deps, command, formatUnregister(result), result);
    });
}
