import { z } from "zod";
import { AgentProjectSchema, IdSchema, IsoDateTimeSchema } from "@devguard/shared";

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The device secret and enrollment token are sent to this URL, so: `https`, or `http` only to a loopback host
 * (local development); no credentials, query or fragment in it, so it is safe to display.
 */
export function isAcceptableServerUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const schemeOk = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
  return schemeOk && url.username === "" && url.password === "" && url.search === "" && url.hash === "";
}

/** `config.json`: where the server is and which device this is. Not secret. */
export const AgentConfigSchema = z
  .object({
    serverUrl: z.string().max(2048).refine(isAcceptableServerUrl, "must be https (http only for localhost) with no credentials, query or fragment"),
    deviceId: IdSchema,
  })
  .strict();
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/** `credentials.json`: the per-device secret issued at enrollment (ADR-006). Secret: never print or log. */
export const DeviceCredentialsSchema = z
  .object({
    deviceId: IdSchema,
    deviceSecret: z.string().min(1).max(512),
  })
  .strict();
export type DeviceCredentials = z.infer<typeof DeviceCredentialsSchema>;

/** `repos.json`: repositories manually registered to a project (the fallback in ADR-003/008). */
export const RegisteredReposSchema = z
  .object({
    repos: z
      .array(
        z
          .object({
            repoPath: z.string().min(1).max(4096),
            projectId: IdSchema,
            registeredAt: IsoDateTimeSchema,
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();
export type RegisteredRepos = z.infer<typeof RegisteredReposSchema>;

/** `policies/<projectId>.json`: last synced project policy and when it was fetched (ADR-004). */
export const CachedPolicySchema = z
  .object({
    fetchedAt: IsoDateTimeSchema,
    project: AgentProjectSchema,
  })
  .strict();
export type CachedPolicy = z.infer<typeof CachedPolicySchema>;

/** Project ids become file names, so only a conservative alphabet is accepted (no path separators or dots). */
const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export function isSafeProjectId(projectId: string): boolean {
  return SAFE_PROJECT_ID.test(projectId);
}

/**
 * `install.json`: what `devguard install` changed, so `uninstall` can put everything back. `previousHooksPath` is the
 * user's own global `core.hooksPath` before DevGuard (null if it was unset).
 */
export const InstallStateSchema = z
  .object({
    global: z
      .object({
        hooksDir: z.string().min(1).max(4096),
        previousHooksPath: z.string().min(1).max(4096).nullable(),
        installedAt: IsoDateTimeSchema,
      })
      .strict()
      .optional(),
    repos: z
      .array(
        z
          .object({
            repoPath: z.string().min(1).max(4096),
            hooksDir: z.string().min(1).max(4096),
            installedAt: IsoDateTimeSchema,
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();
export type InstallState = z.infer<typeof InstallStateSchema>;
