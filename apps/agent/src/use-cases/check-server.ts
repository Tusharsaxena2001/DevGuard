import type { ApiClient, ApiFailure } from "../ports/api-client.js";
import type { AgentLocation } from "../ports/agent-location.js";
import type { Clock } from "../ports/clock.js";
import type { ConfigStore } from "../ports/config-store.js";
import { loadEnrollment } from "./load-enrollment.js";
import { recordContact } from "./record-contact.js";

export type ServerCheck =
  | { readonly state: "reachable" }
  | { readonly state: "not_enrolled" }
  | { readonly state: "unusable_state" }
  | { readonly state: "failed"; readonly reason: ApiFailure };

export interface CheckServerDeps {
  readonly store: ConfigStore;
  readonly api: ApiClient;
  readonly clock: Clock;
  readonly agent: AgentLocation;
}

/** Sends a heartbeat to confirm the server accepts this device. On success the contact time is remembered. */
export async function checkServer(deps: CheckServerDeps): Promise<ServerCheck> {
  const enrollment = await loadEnrollment(deps.store);
  if (!enrollment.ok) return { state: enrollment.reason === "not_enrolled" ? "not_enrolled" : "unusable_state" };
  const result = await deps.api.heartbeat(enrollment.value, { agentVersion: deps.agent.version });
  if (!result.ok) return { state: "failed", reason: result.reason };
  await recordContact(deps.store, deps.clock);
  return { state: "reachable" };
}
