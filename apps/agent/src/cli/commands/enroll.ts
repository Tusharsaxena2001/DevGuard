import type { Command } from "commander";
import { AgentError } from "../../errors.js";
import { ExitCode } from "../../exit-codes.js";
import { FAILURE_TEXT, formatEnroll } from "../../presentation/enroll.js";
import { enrollDevice } from "../../use-cases/enroll-device.js";
import type { CliDeps } from "../deps.js";

interface Options {
  server: string;
  token?: string;
  tokenStdin?: boolean;
}

/** `--token` is visible in process listings and shell history; `--token-stdin` keeps it out of both. */
async function tokenFrom(options: Options, deps: CliDeps): Promise<string> {
  if ((options.token === undefined) === (options.tokenStdin !== true)) {
    throw new AgentError("usage_error", "Give the enrollment token with exactly one of --token <token> or --token-stdin.");
  }
  return options.token ?? (await deps.readStdin());
}

export function registerEnroll(program: Command, deps: CliDeps): void {
  program
    .command("enroll")
    .description("Enroll this device with the DevGuard server (one time) and install the Git hook")
    .requiredOption("--server <url>", "DevGuard server address (https; http only for localhost)")
    .option("--token <token>", "one-time enrollment token from the dashboard (visible in the process list and shell history; prefer --token-stdin)")
    .option("--token-stdin", "read the enrollment token from standard input (keeps it out of shell history)")
    .action(async (options: Options, command: Command) => {
      const token = await tokenFrom(options, deps);
      const outcome = await enrollDevice({ ...deps }, { serverUrl: options.server, token });
      if (!outcome.ok) {
        deps.logger.error(FAILURE_TEXT[outcome.reason]);
        // The server may have accepted the token even though the answer never arrived.
        if (outcome.reason === "unreachable") deps.logger.error("If the server did receive the request, the token is now used: ask your administrator for a new one if the next attempt says it is invalid.");
        deps.setExitCode(ExitCode.usageOrConfig);
        return;
      }
      if (command.optsWithGlobals<{ json?: boolean }>().json) {
        deps.logger.info(JSON.stringify({ enrolled: true, deviceId: outcome.deviceId, serverUrl: outcome.serverUrl, hookInstalled: outcome.hook.ok, sync: outcome.sync.state }, null, 2));
      } else {
        for (const line of formatEnroll(outcome)) deps.logger.info(line);
      }
      if (!outcome.hook.ok) deps.setExitCode(ExitCode.usageOrConfig);
    });
}
