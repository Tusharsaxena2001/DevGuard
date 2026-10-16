import type { ConfigStore, StoreRead } from "../ports/config-store.js";
import type { EventSpool, SpoolStats } from "../ports/event-spool.js";
import { classifyFreshness, type Freshness } from "./policy-freshness.js";

export type FileState = "ok" | "missing" | "invalid" | "insecure_permissions" | "unreadable";

export interface PolicyStatus {
  readonly projectId: string;
  readonly state: FileState;
  readonly fetchedAt?: string;
  /** Where the policy came from; absent in older caches (treated as local). */
  readonly source?: "server" | "local";
  /** ADR-004 freshness of a server policy (local ones never age). Only set when the caller supplies the clock and limit. */
  readonly freshness?: Freshness;
}

export interface FreshnessCheck {
  readonly now: Date;
  readonly maxStaleMinutes: number;
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
  /** Last time the server answered this device (informational). */
  readonly lastContactAt?: string;
  readonly config: FileState;
  readonly credentials: FileState;
  readonly repos: FileState;
  /** The policy cache directory itself: `ok` (possibly empty), or why it could not be listed. */
  readonly policyCache: FileState;
  readonly registeredRepoCount: number;
  readonly policies: readonly PolicyStatus[];
  /** Events waiting for delivery. Absent when the caller did not supply a spool. */
  readonly events?: SpoolStats;
}

function stateOf<T>(read: Awaited<StoreRead<T>>): FileState {
  if (!read.ok) return read.reason;
  return read.value === undefined ? "missing" : "ok";
}

const isProblem = (state: FileState): boolean => state !== "ok" && state !== "missing";

export async function getStatus(store: ConfigStore, freshness?: FreshnessCheck, spool?: EventSpool): Promise<StatusReport> {
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
    if (read.ok && read.value !== undefined) {
      const source = read.value.source === "server" ? "server" : "local";
      policies.push({
        projectId,
        state,
        fetchedAt: read.value.fetchedAt,
        source,
        ...(freshness !== undefined && source === "server" ? { freshness: classifyFreshness(read.value.fetchedAt, freshness.now, freshness.maxStaleMinutes) } : {}),
      });
    } else policies.push({ projectId, state });
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
  const events = spool === undefined ? undefined : await spool.stats().catch(() => undefined);
  return {
    location: store.location,
    enrolled: states[0] === "ok" && states[1] === "ok",
    healthy: !states.some(isProblem) && !isProblem(policyCache) && !policies.some((p) => isProblem(p.state)),
    ...(configValue ? { serverUrl: configValue.serverUrl, deviceId: configValue.deviceId } : {}),
    ...(configValue?.lastContactAt ? { lastContactAt: configValue.lastContactAt } : {}),
    config: states[0] ?? "missing",
    credentials: states[1] ?? "missing",
    repos: states[2] ?? "missing",
    policyCache,
    registeredRepoCount: repos.ok ? (repos.value?.repos.length ?? 0) : 0,
    policies,
    ...(events === undefined ? {} : { events }),
  };
}
