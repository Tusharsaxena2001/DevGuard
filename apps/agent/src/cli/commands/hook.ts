import type { Command } from "commander";
import { ExitCode } from "../../exit-codes.js";
import { AGENT_VERSION } from "../../version.js";
import { runPrePush } from "../../use-cases/run-pre-push.js";
import type { CliDeps } from "../deps.js";

/** Internal entry points called by the installed Git hooks. Hidden from help. */
export function registerHook(program: Command, deps: CliDeps): void {
  const hook = program.command("hook", { hidden: true }).description("Internal Git hook entry points");
  hook
    .command("pre-push <remote-name> <remote-url>")
    .allowExcessArguments()
    .action(async (remoteName: string, remoteUrl: string) => {
      const outcome = await runPrePush(
        { remoteName, remoteUrl, stdin: await deps.readStdin(), cwd: deps.cwd() },
        { store: deps.store, git: deps.git, events: deps.events, clock: deps.clock, newId: deps.newId, agentVersion: AGENT_VERSION },
      );
      for (const line of outcome.lines) deps.logger.error(line);
      deps.setExitCode(outcome.exitCode === 0 ? ExitCode.ok : ExitCode.blocked);
    });
}
