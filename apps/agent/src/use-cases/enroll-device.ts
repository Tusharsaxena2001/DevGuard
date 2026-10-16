import { EnrollRequestSchema } from "@devguard/shared";
import { AgentError } from "../errors.js";
import type { ApiClient, ApiFailure } from "../ports/api-client.js";
import type { DeviceInfo } from "../ports/device-info.js";
import { isAcceptableServerUrl } from "../ports/local-state.js";
import { installGlobal, type GlobalInstallResult, type HookDeps } from "./install-hooks.js";
import { syncProjects, type SyncOutcome } from "./sync-projects.js";

export interface EnrollDeps extends HookDeps {
  readonly api: ApiClient;
  readonly device: DeviceInfo;
  readonly userHome: string | undefined;
}

export type EnrollOutcome =
  | {
      readonly ok: true;
      readonly deviceId: string;
      readonly serverUrl: string;
      /** A previous local enrollment was replaced (the old device record stays on the server until an admin revokes it). */
      readonly replacedPrevious: boolean;
      readonly hook: { readonly ok: true; readonly result: GlobalInstallResult } | { readonly ok: false; readonly message: string };
      /** The first policy sync (workflow: device-enrollment step 5). A failure here does not undo the enrollment. */
      readonly sync: SyncOutcome;
    }
  | { readonly ok: false; readonly reason: ApiFailure };

/**
 * Exchange the one-time token for device credentials, save them (0600), then install the global hook (workflow:
 * device-enrollment step 4). Nothing local changes unless the server accepted the token. The token is never echoed.
 */
export async function enrollDevice(deps: EnrollDeps, input: { readonly serverUrl: string; readonly token: string }): Promise<EnrollOutcome> {
  const serverUrl = input.serverUrl.trim().replace(/\/+$/, "");
  if (!isAcceptableServerUrl(serverUrl)) {
    throw new AgentError("usage_error", "The server URL must be https (http is allowed only for localhost) and contain no credentials, query or fragment.");
  }
  const request = EnrollRequestSchema.safeParse({
    token: input.token.trim(),
    deviceName: deps.device.name,
    os: deps.device.os,
    agentVersion: deps.agent.version,
  });
  if (!request.success) throw new AgentError("usage_error", "The enrollment token is missing or malformed. Copy it again from the dashboard.");

  const previous = await deps.store.readConfig();
  const enrolled = await deps.api.enroll(serverUrl, request.data);
  if (!enrolled.ok) return { ok: false, reason: enrolled.reason };

  const { deviceId, deviceSecret } = enrolled.value;
  try {
    await deps.store.writeCredentials({ deviceId, deviceSecret });
    await deps.store.writeConfig({ serverUrl, deviceId, lastContactAt: deps.clock.now().toISOString() });
  } catch (cause) {
    throw new AgentError(
      "store_write_failed",
      `The server enrolled this device (id ${deviceId}) but DevGuard could not save the credentials locally. Ask an administrator to revoke that device, fix the problem under ${deps.store.location}, then enroll again with a new token.`,
      { cause },
    );
  }

  let hook: Extract<EnrollOutcome, { ok: true }>["hook"];
  try {
    hook = { ok: true, result: await installGlobal(deps, deps.userHome) };
  } catch (error) {
    hook = { ok: false, message: error instanceof AgentError ? error.message : "The hook could not be installed." };
  }
  const sync = await syncProjects({ store: deps.store, api: deps.api, clock: deps.clock }).catch((): SyncOutcome => ({ state: "failed", reason: "unreachable" }));
  return { ok: true, deviceId, serverUrl, replacedPrevious: previous.ok && previous.value !== undefined, hook, sync };
}
