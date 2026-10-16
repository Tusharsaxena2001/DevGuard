import type { DeviceAuth } from "../ports/api-client.js";
import type { ConfigStore } from "../ports/config-store.js";
import { fail, ok, type Result } from "../result.js";

/**
 * The server and credentials of this enrolled device, only if both files are present, trustworthy and agree on the
 * device id. `unusable` covers invalid, insecure or unreadable files (see `devguard status` for which).
 */
export async function loadEnrollment(store: ConfigStore): Promise<Result<DeviceAuth, "not_enrolled" | "unusable">> {
  const [config, credentials] = await Promise.all([store.readConfig(), store.readCredentials()]);
  if (!config.ok || !credentials.ok) return fail("unusable");
  if (config.value === undefined || credentials.value === undefined) return fail("not_enrolled");
  if (config.value.deviceId !== credentials.value.deviceId) return fail("unusable");
  return ok({ serverUrl: config.value.serverUrl, deviceId: credentials.value.deviceId, deviceSecret: credentials.value.deviceSecret });
}
