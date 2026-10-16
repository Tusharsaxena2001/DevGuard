import type { AgentProject } from "@devguard/shared";
import type { ApiClient, ApiFailure } from "../ports/api-client.js";
import type { Clock } from "../ports/clock.js";
import type { ConfigStore } from "../ports/config-store.js";
import { isSafeProjectId } from "../ports/local-state.js";
import { loadEnrollment } from "./load-enrollment.js";

export type SyncOutcome =
  | { readonly state: "updated"; readonly projects: number; readonly removed: number }
  | { readonly state: "unchanged"; readonly projects: number }
  | { readonly state: "not_enrolled" }
  | { readonly state: "unusable_state" }
  | { readonly state: "failed"; readonly reason: ApiFailure };

export interface SyncDeps {
  readonly store: ConfigStore;
  readonly api: ApiClient;
  readonly clock: Clock;
}

/** Server-synced cache entries, by project id. `usable` is false if any cache file cannot be read (then no ETag is sent). */
async function readServerCache(store: ConfigStore): Promise<{ usable: boolean; ids: string[] }> {
  const listed = await store.listPolicyIds();
  if (!listed.ok) return { usable: false, ids: [] };
  const ids: string[] = [];
  let usable = true;
  for (const id of listed.value) {
    const read = await store.readPolicy(id);
    if (!read.ok || read.value === undefined) usable = false;
    else if (read.value.source === "server") ids.push(id);
  }
  return { usable, ids };
}

function sameIds(cached: readonly string[], recorded: readonly string[] | undefined): boolean {
  if (recorded === undefined || recorded.length !== cached.length) return false;
  const set = new Set(recorded);
  return cached.every((id) => set.has(id));
}

/**
 * Brings the local policy cache in line with the server (ADR-008): every project assigned to this device's owner.
 * Server data replaces local data for the same project and projects that are no longer assigned are removed (only
 * entries that came from the server: a policy supplied by hand with `register --policy-file` is never touched).
 * If the server says nothing changed, only the fetch times are refreshed. Never throws for network problems; a failed
 * sync leaves the existing cache exactly as it was, so offline pushes keep following ADR-004.
 */
export async function syncProjects(deps: SyncDeps): Promise<SyncOutcome> {
  const enrollment = await loadEnrollment(deps.store);
  if (!enrollment.ok) return { state: enrollment.reason === "not_enrolled" ? "not_enrolled" : "unusable_state" };

  const config = await deps.store.readConfig();
  if (!config.ok || config.value === undefined) return { state: "unusable_state" };
  const cache = await readServerCache(deps.store);
  // A 304 only means "unchanged on the server"; it cannot restore a cache file that was deleted since. So the ETag is
  // sent only while the cache still holds exactly the projects it was built from.
  const sameSet = sameIds(cache.ids, config.value.syncedProjectIds);
  const etag = cache.usable && sameSet ? config.value.projectsEtag : undefined;

  const reply = await deps.api.getProjects(enrollment.value, etag);
  if (!reply.ok) return { state: "failed", reason: reply.reason };
  const now = deps.clock.now().toISOString();

  if (reply.value.notModified) {
    for (const id of cache.ids) {
      const read = await deps.store.readPolicy(id);
      if (read.ok && read.value !== undefined) await deps.store.writePolicy({ ...read.value, fetchedAt: now });
    }
    await deps.store.writeConfig({ ...config.value, lastContactAt: now });
    return { state: "unchanged", projects: cache.ids.length };
  }

  const projects: readonly AgentProject[] = reply.value.sync.projects;
  // Project ids become file names: refuse the whole reply rather than cache a subset of what the server meant.
  if (projects.some((p) => !isSafeProjectId(p.projectId)) || new Set(projects.map((p) => p.projectId)).size !== projects.length) {
    return { state: "failed", reason: "invalid_response" };
  }
  for (const project of projects) await deps.store.writePolicy({ fetchedAt: now, project, source: "server" });
  const keep = new Set(projects.map((p) => p.projectId));
  const stale = cache.ids.filter((id) => !keep.has(id));
  for (const id of stale) await deps.store.deletePolicy(id);

  // The ETag belongs to this exact set of projects: replace it (or drop it if the server sent none).
  await deps.store.writeConfig({
    serverUrl: config.value.serverUrl,
    deviceId: config.value.deviceId,
    lastContactAt: now,
    syncedProjectIds: projects.map((p) => p.projectId),
    ...(reply.value.etag === undefined ? {} : { projectsEtag: reply.value.etag }),
  });
  return { state: "updated", projects: projects.length, removed: stale.length };
}
