import type { Command } from "commander";
import { ExitCode } from "../../exit-codes.js";
import { AGENT_VERSION } from "../../version.js";
import { checkException } from "../../use-cases/check-exception.js";
import { deliverEvents } from "../../use-cases/deliver-events.js";
import { reportNewFingerprints } from "../../use-cases/report-fingerprints.js";
import { runPrePush } from "../../use-cases/run-pre-push.js";
import { syncProjects } from "../../use-cases/sync-projects.js";
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
        {
          store: deps.store,
          git: deps.git,
          events: deps.events,
          clock: deps.clock,
          newId: deps.newId,
          agentVersion: AGENT_VERSION,
          maxStaleMinutes: deps.policyMaxStaleMinutes,
          checkException: (projectId, destination) => checkException({ store: deps.store, api: deps.hookApi }, projectId, destination),
          refresh: async () => void (await syncProjects({ store: deps.store, api: deps.hookApi, clock: deps.clock })),
          learn: async (matches, pushUrl, cwd) => void (await reportNewFingerprints({ store: deps.store, git: deps.git, api: deps.hookApi }, matches, pushUrl, cwd)),
        },
      );
      for (const line of outcome.lines) deps.logger.error(line);
      deps.setExitCode(outcome.exitCode === 0 ? ExitCode.ok : ExitCode.blocked);
      // The decision is made and shown. Delivering the event (and any earlier ones) is best effort and short.
      await deliverEvents({ store: deps.store, spool: deps.spool, api: deps.hookApi, clock: deps.clock, maxBatches: 1 }).catch(() => undefined);
    });
}
