import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { AgentError } from "../../errors.js";
import { fail, ok } from "../../result.js";
import type { ConfigStore, StoreList, StoreRead } from "../../ports/config-store.js";
import {
  AgentConfigSchema,
  CachedPolicySchema,
  DeviceCredentialsSchema,
  InstallStateSchema,
  RegisteredReposSchema,
  isSafeProjectId,
  type CachedPolicy,
} from "../../ports/local-state.js";
import { checkDirectory, readJsonFile, writeJsonFile } from "./atomic-file.js";

const POLICY_FILE = /^(.+)\.json$/;

/** Run `read` only if every directory on the way is trusted (see `checkDirectory`). */
async function inTrustedDirs<T>(dirs: readonly string[], read: () => Promise<T>): Promise<T | { ok: false; reason: "invalid" | "insecure_permissions" | "unreadable" }> {
  for (const dir of dirs) {
    const check = await checkDirectory(dir);
    if (!check.ok) return fail(check.reason);
  }
  return read();
}

/** `ConfigStore` over a private directory (see `resolveDevGuardHome`). Nothing is created until the first write. */
export function createFsConfigStore(home: string): ConfigStore {
  const file = (name: string): string => join(home, name);
  const policiesDir = join(home, "policies");
  const policyFile = (projectId: string): string => join(home, "policies", `${projectId}.json`);

  return {
    location: home,

    readConfig: () => inTrustedDirs([home], () => readJsonFile(file("config.json"), AgentConfigSchema, { requirePrivate: false })),
    writeConfig: (config) => writeJsonFile(file("config.json"), AgentConfigSchema, config),

    readCredentials: () => inTrustedDirs([home], () => readJsonFile(file("credentials.json"), DeviceCredentialsSchema, { requirePrivate: true })),
    writeCredentials: (credentials) => writeJsonFile(file("credentials.json"), DeviceCredentialsSchema, credentials),

    readRepos: () => inTrustedDirs([home], () => readJsonFile(file("repos.json"), RegisteredReposSchema, { requirePrivate: false })),
    writeRepos: (repos) => writeJsonFile(file("repos.json"), RegisteredReposSchema, repos),

    readInstall: () => inTrustedDirs([home], () => readJsonFile(file("install.json"), InstallStateSchema, { requirePrivate: false })),
    writeInstall: (install) => writeJsonFile(file("install.json"), InstallStateSchema, install),

    async listPolicyIds(): Promise<StoreList> {
      return inTrustedDirs([home, policiesDir], async () => {
        try {
          const names = await readdir(policiesDir);
          return ok(names.map((name) => POLICY_FILE.exec(name)?.[1]).filter((id): id is string => id !== undefined).sort());
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === "ENOENT" ? ok([]) : fail("unreadable");
        }
      });
    },

    async readPolicy(projectId: string): Promise<StoreRead<CachedPolicy>> {
      if (!isSafeProjectId(projectId)) return fail("invalid");
      const read = await inTrustedDirs([home, policiesDir], () =>
        readJsonFile(policyFile(projectId), CachedPolicySchema, { requirePrivate: false }),
      );
      // A cache file must hold the project it is named after, so one project's policy is never used for another.
      if (read.ok && read.value !== undefined && read.value.project.projectId !== projectId) return fail("invalid");
      return read;
    },

    async writePolicy(policy: CachedPolicy): Promise<void> {
      const { projectId } = policy.project;
      if (!isSafeProjectId(projectId)) throw new AgentError("store_write_failed", "Refusing to cache a policy for an unsafe project id.");
      await writeJsonFile(policyFile(projectId), CachedPolicySchema, policy);
    },
  };
}
