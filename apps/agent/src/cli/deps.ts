import type { ExitCode } from "../exit-codes.js";
import type { AgentLocation } from "../ports/agent-location.js";
import type { ApiClient } from "../ports/api-client.js";
import type { Clock } from "../ports/clock.js";
import type { ConfigStore } from "../ports/config-store.js";
import type { DeviceInfo } from "../ports/device-info.js";
import type { EventSink } from "../ports/event-sink.js";
import type { EventSpool } from "../ports/event-spool.js";
import type { GitPort } from "../ports/git.js";
import type { HookFiles } from "../ports/hook-files.js";
import type { PolicyFileReader } from "../ports/policy-file.js";
import type { Logger } from "../ports/logger.js";

/** What commands may use. Built once in `main.ts`; tests pass fakes. */
export interface CliDeps {
  readonly store: ConfigStore;
  readonly logger: Logger;
  readonly git: GitPort;
  readonly files: HookFiles;
  readonly policyFile: PolicyFileReader;
  readonly events: EventSink;
  /** Events waiting for delivery to the server. */
  readonly spool: EventSpool;
  readonly clock: Clock;
  readonly api: ApiClient;
  /** Same API, with a short timeout and no retries: used inside the Git hook so a slow server cannot stall a push. */
  readonly hookApi: ApiClient;
  /** ADR-004: cached server policy older than this is expired. */
  readonly policyMaxStaleMinutes: number;
  /** This machine's name and OS, sent at enrollment. */
  readonly device: DeviceInfo;
  readonly agent: AgentLocation;
  readonly newId: () => string;
  /** The whole of stdin (used by the pre-push hook). */
  readonly readStdin: () => Promise<string>;
  readonly cwd: () => string;
  /** The user's home directory, for expanding `~` in a previous core.hooksPath. */
  readonly userHome: string | undefined;
  /** Commands report a non-zero outcome here instead of exiting the process. */
  readonly setExitCode: (code: ExitCode) => void;
}
