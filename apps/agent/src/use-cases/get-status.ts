import type { ConfigStore, StoreRead } from "../ports/config-store.js";

export type FileState = "ok" | "missing" | "invalid" | "insecure_permissions" | "unreadable";

export interface PolicyStatus {
  readonly projectId: string;
  readonly state: FileState;
  readonly fetchedAt?: string;
}

/** Local state summary. Deliberately has no field that could hold a secret. */
export interface StatusReport {
  readonly location: string;
  /** Both a valid config and valid, private credentials exist. */
  readonly enrolled: boolean;
  /** No file is invalid, insecure or unreadable. A device that is simply not enrolled yet is healthy. */
  readonly healthy: boolean;
  readonly serverUrl?: string;
  readonly deviceId?: string;
  readonly config: FileState;
  readonly credentials: FileState;
  readonly repos: FileState;
  /** The policy cache directory itself: `ok` (possibly empty), or why it could not be listed. */
  readonly policyCache: FileState;
  readonly registeredRepoCount: number;
  readonly policies: readonly PolicyStatus[];
}

function stateOf<T>(read: Awaited<StoreRead<T>>): FileState {
  if (!read.ok) return read.reason;
  return read.value === undefined ? "missing" : "ok";
}

const isProblem = (state: FileState): boolean => state !== "ok" && state !== "missing";

export async function getStatus(store: ConfigStore): Promise<StatusReport> {
  const [config, credentials, repos, policyIds] = await Promise.all([
    store.readConfig(),
    store.readCredentials(),
    store.readRepos(),
    store.listPolicyIds(),
  ]);

  const policies: PolicyStatus[] = [];
  for (const projectId of policyIds.ok ? policyIds.value : []) {
    const read = await store.readPolicy(projectId);
    const state = stateOf(read);
    policies.push(read.ok && read.value !== undefined ? { projectId, state, fetchedAt: read.value.fetchedAt } : { projectId, state });
  }

  const states = [stateOf(config), stateOf(credentials), stateOf(repos)];
  const configValue = config.ok ? config.value : undefined;
  const credentialsValue = credentials.ok ? credentials.value : undefined;
  // A config and credentials that name different devices are inconsistent: neither can be trusted.
  if (configValue && credentialsValue && configValue.deviceId !== credentialsValue.deviceId) {
    states[0] = "invalid";
    states[1] = "invalid";
  }
  const policyCache: FileState = policyIds.ok ? "ok" : policyIds.reason;
  return {
    location: store.location,
    enrolled: states[0] === "ok" && states[1] === "ok",
    healthy: !states.some(isProblem) && !isProblem(policyCache) && !policies.some((p) => isProblem(p.state)),
    ...(configValue ? { serverUrl: configValue.serverUrl, deviceId: configValue.deviceId } : {}),
    config: states[0] ?? "missing",
    credentials: states[1] ?? "missing",
    repos: states[2] ?? "missing",
    policyCache,
    registeredRepoCount: repos.ok ? (repos.value?.repos.length ?? 0) : 0,
    policies,
  };
}
