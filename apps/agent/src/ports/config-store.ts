import type { Result } from "../result.js";
import type { AgentConfig, CachedPolicy, DeviceCredentials, InstallState, RegisteredRepos } from "./local-state.js";

/**
 * Why a stored file could not be used. `insecure_permissions` means the file or its directory is owned by someone
 * else, writable by others (readable too, for credentials) or not a regular file: it is refused, never read.
 */
export type StoreReadReason = "invalid" | "insecure_permissions" | "unreadable";

/** `ok` with `undefined` means the file does not exist yet. */
export type StoreRead<T> = Result<T | undefined, StoreReadReason>;

/** Names found in a directory. An unreadable or untrusted directory is an error, not an empty list. */
export type StoreList = Result<string[], StoreReadReason>;

/** Local agent state (config dir). Reads never throw; writes throw `AgentError("store_write_failed")`. */
export interface ConfigStore {
  /** Directory holding the state, for display. */
  readonly location: string;
  readConfig(): Promise<StoreRead<AgentConfig>>;
  writeConfig(config: AgentConfig): Promise<void>;
  readCredentials(): Promise<StoreRead<DeviceCredentials>>;
  writeCredentials(credentials: DeviceCredentials): Promise<void>;
  readRepos(): Promise<StoreRead<RegisteredRepos>>;
  writeRepos(repos: RegisteredRepos): Promise<void>;
  readInstall(): Promise<StoreRead<InstallState>>;
  writeInstall(install: InstallState): Promise<void>;
  /** Names (without `.json`) of cached policy files. Unsafe names are listed too; `readPolicy` reports them invalid. */
  listPolicyIds(): Promise<StoreList>;
  readPolicy(projectId: string): Promise<StoreRead<CachedPolicy>>;
  writePolicy(policy: CachedPolicy): Promise<void>;
}
