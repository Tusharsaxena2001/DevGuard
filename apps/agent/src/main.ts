#!/usr/bin/env node
// Composition root: the only place that builds adapters and wires them to the CLI.
import { randomUUID } from "node:crypto";
import { homedir, hostname, platform, release } from "node:os";
import { fileURLToPath } from "node:url";
import { createHttpApiClient } from "./adapters/http-api-client.js";
import { createConsoleLogger } from "./adapters/console-logger.js";
import { createEventLog } from "./adapters/event-log.js";
import { createTeeEventSink } from "./adapters/tee-event-sink.js";
import { createGit } from "./adapters/git/exec-git.js";
import { createFsConfigStore } from "./adapters/fs-store/fs-config-store.js";
import { createFsEventSpool } from "./adapters/fs-store/fs-event-spool.js";
import { resolveDevGuardHome } from "./adapters/fs-store/paths.js";
import { createFsHookFiles } from "./adapters/hooks/fs-hook-files.js";
import { createPolicyFileReader } from "./adapters/policy-file.js";
import { readAllStdin } from "./adapters/stdin.js";
import { runCli } from "./cli/run.js";
import { ExitCode } from "./exit-codes.js";
import { parseMaxStaleMinutes } from "./use-cases/policy-freshness.js";
import { AGENT_VERSION } from "./version.js";

const logger = createConsoleLogger();
const home = resolveDevGuardHome(process.env, homedir());

try {
  if (!home.ok) {
    logger.error("DEVGUARD_HOME must be an absolute path.");
    process.exitCode = ExitCode.usageOrConfig;
  } else {
    const spool = createFsEventSpool(home.value);
    process.exitCode = await runCli(process.argv.slice(2), {
      store: createFsConfigStore(home.value),
      spool,
      logger,
      git: createGit(),
      files: createFsHookFiles(),
      policyFile: createPolicyFileReader(),
      // Every decision is kept in the local log and queued for delivery; delivery failure never affects a push.
      events: createTeeEventSink([createEventLog(home.value), { record: (event) => spool.add(event) }]),
      clock: { now: () => new Date() },
      api: createHttpApiClient(),
      // Inside the hook a slow or dead server must cost a push at most a couple of seconds.
      hookApi: createHttpApiClient({ timeoutMs: 3000, maxAttempts: 1 }),
      policyMaxStaleMinutes: parseMaxStaleMinutes(process.env["DEVGUARD_POLICY_MAX_STALE_MINUTES"]),
      device: { name: hostname().slice(0, 200) || "unknown", os: `${platform()} ${release()}`.slice(0, 100) },
      agent: { nodePath: process.execPath, mainPath: fileURLToPath(import.meta.url), version: AGENT_VERSION },
      newId: randomUUID,
      readStdin: readAllStdin,
      cwd: () => process.cwd(),
      userHome: homedir(),
    });
  }
} catch {
  // Node would exit 1 on an uncaught error, which the hook contract reads as "blocked": keep 1 for real blocks only.
  logger.error("Unexpected error. Run again, and report it if it persists.");
  process.exitCode = ExitCode.usageOrConfig;
}
