import type { AgentProject } from "@devguard/shared";
import type { ConfigStore, StoreList, StoreRead } from "../../src/ports/config-store.js";
import type { CachedPolicy, InstallState } from "../../src/ports/local-state.js";
import type { Logger } from "../../src/ports/logger.js";
import { ok } from "../../src/result.js";

export interface RecordingLogger extends Logger {
  readonly out: string[];
  readonly err: string[];
}

export function recordingLogger(): RecordingLogger {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, info: (m) => void out.push(m), error: (m) => void err.push(m) };
}

/** Synthetic secret assembled at runtime so no secret-shaped literal sits in the repo. */
export const syntheticSecret = (): string => ["dg", "secret", "Z9y8X7w6V5u4T3s2"].join("_");

export const project = (projectId = "proj-1"): AgentProject => ({
  projectId,
  name: "Portal",
  policy: {
    version: 1,
    mode: "enforce",
    classification: "confidential",
    destinations: [{ host: "github.com", repoPath: "acme/portal", type: "exact" }],
    prohibitedGlobs: [".env"],
    secretRules: ["github_token"],
  },
  canonicalRepos: [{ host: "github.com", repoPath: "acme/portal" }],
  fingerprints: ["a".repeat(40)],
});

export const cachedPolicy = (projectId = "proj-1", fetchedAt = "2026-06-01T12:00:00.000Z"): CachedPolicy => ({
  fetchedAt,
  project: project(projectId),
});

type Overrides = Partial<Record<"config" | "credentials" | "repos", StoreRead<unknown>>> & { policyList?: StoreList; install?: StoreRead<InstallState> };

/** In-memory store whose reads are scripted per file. Anything not scripted is "missing". */
export function fakeStore(
  overrides: Overrides = {},
  policies: Record<string, StoreRead<CachedPolicy>> = {},
  location = "/fake/home",
): ConfigStore {
  const missing = ok(undefined);
  let installState: InstallState = { repos: [] };
  return {
    location,
    readConfig: async () => (overrides.config ?? missing) as never,
    readCredentials: async () => (overrides.credentials ?? missing) as never,
    readRepos: async () => (overrides.repos ?? missing) as never,
    listPolicyIds: async () => overrides.policyList ?? ok(Object.keys(policies).sort()),
    readPolicy: async (id) => policies[id] ?? missing,
    readInstall: async () => overrides.install ?? ok(installState),
    writeInstall: async (next) => void (installState = next),
    writeConfig: async () => undefined,
    writeCredentials: async () => undefined,
    writeRepos: async () => undefined,
    writePolicy: async () => undefined,
    deletePolicy: async () => undefined,
  };
}

/** A store that fails the test if anything touches it. */
export function untouchableStore(): ConfigStore {
  const boom = (): never => {
    throw new Error("store must not be used");
  };
  return {
    location: "/untouchable",
    readConfig: boom,
    readCredentials: boom,
    readRepos: boom,
    listPolicyIds: boom,
    readPolicy: boom,
    readInstall: boom,
    writeInstall: boom,
    writeConfig: boom,
    writeCredentials: boom,
    writeRepos: boom,
    writePolicy: boom,
    deletePolicy: boom,
  };
}

// ---- Git, hook files, event sink, deps ---------------------------------------------------------------------

import type { EventBatchResult, ExceptionEntry, ExceptionPage, ExceptionValidationResult, SecurityEventBatch, SecurityEventInput } from "@devguard/shared";
import type { CliDeps } from "../../src/cli/deps.js";
import type { ApiClient, ApiResult, ProjectsReply } from "../../src/ports/api-client.js";
import type { EventSink } from "../../src/ports/event-sink.js";
import type { EventSpool } from "../../src/ports/event-spool.js";
import type { AddedLineRecord, CommitBaseline, GitPort } from "../../src/ports/git.js";
import type { ChangedFileStatus } from "../../src/ports/git-types.js";
import type { HookFiles } from "../../src/ports/hook-files.js";

export interface GitScript {
  /** `undefined` (explicitly) means "not in a repository". Default "/repo". */
  repoRoot?: string | undefined;
  /** Root of the main work tree (differs from repoRoot inside a linked worktree). Defaults to repoRoot. */
  mainRoot?: string | undefined;
  /** Peeled object types by sha; anything not listed is a commit. */
  objectTypes?: Record<string, string | undefined>;
  globalConfig?: Record<string, string>;
  /** Keyed by `<repoPath>\0<key>`. */
  localConfig?: Record<string, string>;
  /** Root commits (fingerprints) of the repo. */
  roots?: string[];
  remotes?: string[];
  knownObjects?: string[];
  /** "ancestor>descendant" pairs. */
  ancestors?: string[];
  /** Commits `listCommits` returns, keyed by local sha. */
  commits?: Record<string, string[]>;
  truncated?: string[];
  paths?: Record<string, ChangedFileStatus[]>;
  lines?: Record<string, AddedLineRecord[]>;
  /** Make a method throw. `commit` narrows it to one commit. */
  failing?: { method: keyof GitPort; commit?: string }[];
}

export interface FakeGit extends GitPort {
  readonly globalConfig: Map<string, string>;
  readonly calls: { method: string; args: unknown[] }[];
}

export function fakeGit(script: GitScript = {}): FakeGit {
  const globalConfig = new Map(Object.entries(script.globalConfig ?? {}));
  const calls: { method: string; args: unknown[] }[] = [];
  const repoRoot = "repoRoot" in script ? script.repoRoot : "/repo";
  const maybeFail = (method: keyof GitPort, commit?: string): void => {
    if (script.failing?.some((f) => f.method === method && (f.commit === undefined || f.commit === commit))) {
      throw new Error(`fake git failure in ${method}`);
    }
  };
  const record = (method: string, ...args: unknown[]): void => void calls.push({ method, args });
  return {
    globalConfig,
    calls,
    globalConfigGet: async (key) => globalConfig.get(key),
    globalConfigSet: async (key, value) => void globalConfig.set(key, value),
    globalConfigUnset: async (key) => void globalConfig.delete(key),
    localConfigGet: async (repoPath, key) => script.localConfig?.[`${repoPath}\0${key}`],
    repoRoot: async () => repoRoot,
    mainWorktreeRoot: async () => ("mainRoot" in script ? script.mainRoot : repoRoot),
    peeledObjectType: async (sha) => (maybeFail("peeledObjectType"), sha in (script.objectTypes ?? {}) ? script.objectTypes?.[sha] : "commit"),
    rootCommits: async () => (maybeFail("rootCommits"), script.roots ?? []),
    remoteUrls: async () => (maybeFail("remoteUrls"), script.remotes ?? []),
    effectiveHooksDir: async (repoPath) => `${repoPath}/.git/hooks`,
    defaultHooksDir: async (repoPath) => `${repoPath}/.git/hooks`,
    objectExists: async (sha) => (maybeFail("objectExists"), script.knownObjects?.includes(sha) ?? false),
    isAncestor: async (a, d) => (maybeFail("isAncestor"), script.ancestors?.includes(`${a}>${d}`) ?? false),
    listCommits: async (localSha, baseline: CommitBaseline, limit) => {
      maybeFail("listCommits");
      record("listCommits", localSha, baseline, limit);
      return { commits: script.commits?.[localSha] ?? [], truncated: script.truncated?.includes(localSha) ?? false };
    },
    changedPaths: async (commit) => (maybeFail("changedPaths", commit), script.paths?.[commit] ?? []),
    addedLines: async (commit) => (maybeFail("addedLines", commit), script.lines?.[commit] ?? []),
  };
}

export interface MemoryHookFiles extends HookFiles {
  readonly files: Map<string, string>;
}

export function memoryHookFiles(initial: Record<string, string> = {}): MemoryHookFiles {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: async (path) => files.get(path),
    writeExecutable: async (path, content) => void files.set(path, content),
    move: async (from, to) => {
      if (files.has(to)) throw new Error("destination exists");
      const content = files.get(from);
      if (content === undefined) throw new Error("source missing");
      files.set(to, content);
      files.delete(from);
    },
    remove: async (path) => void files.delete(path),
    removeDirIfEmpty: async () => undefined,
  };
}

export interface MemoryEvents extends EventSink {
  readonly events: SecurityEventInput[];
}

export function memoryEvents(failWith?: Error): MemoryEvents {
  const events: SecurityEventInput[] = [];
  return {
    events,
    record: async (event) => {
      if (failWith) throw failWith;
      events.push(event);
    },
  };
}

export const fixedClock = (iso = "2026-06-01T12:00:00.000Z") => ({ now: () => new Date(iso) });

export function sequentialIds(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n).padStart(8, "0")}`;
}

/** Full CLI dependencies with benign fakes; override only what a test cares about. */
export function cliDeps(over: Partial<Omit<CliDeps, "setExitCode">> = {}): Omit<CliDeps, "setExitCode"> {
  return {
    store: fakeStore(),
    logger: recordingLogger(),
    git: fakeGit(),
    files: memoryHookFiles(),
    policyFile: { read: async () => ({ ok: false, reason: "unreadable" }) },
    events: memoryEvents(),
    spool: memorySpool(),
    clock: fixedClock(),
    api: fakeApi(),
    hookApi: fakeApi(),
    policyMaxStaleMinutes: 60,
    device: { name: "test-laptop", os: "linux 6.0" },
    agent: { nodePath: "/usr/bin/node", mainPath: "/opt/devguard/main.js", version: "0.0.0" },
    newId: sequentialIds(),
    readStdin: async () => "",
    cwd: () => "/repo",
    userHome: "/home/dev",
    ...over,
  };
}

// ---- API client ----------------------------------------------------------------------------------------------

export interface FakeApi extends ApiClient {
  readonly calls: { method: string; args: unknown[] }[];
}

/** Scripted API client: unscripted calls fail the test by reporting "unreachable" and recording nothing useful. */
export function fakeApi(
  script: {
    enroll?: ApiResult<{ deviceId: string; deviceSecret: string }>;
    heartbeat?: ApiResult<undefined>;
    getProjects?: ApiResult<ProjectsReply>;
    reportFingerprint?: ApiResult<undefined>;
    sendEvents?: ApiResult<EventBatchResult> | ((batch: SecurityEventBatch) => ApiResult<EventBatchResult>);
    requestException?: ApiResult<ExceptionEntry>;
    listExceptions?: ApiResult<ExceptionPage>;
    getException?: ApiResult<ExceptionEntry>;
    validateException?: ApiResult<ExceptionValidationResult>;
  } = {},
): FakeApi {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    enroll: async (...args) => {
      calls.push({ method: "enroll", args });
      return script.enroll ?? { ok: false, reason: "unreachable" };
    },
    heartbeat: async (...args) => {
      calls.push({ method: "heartbeat", args });
      return script.heartbeat ?? { ok: false, reason: "unreachable" };
    },
    getProjects: async (...args) => {
      calls.push({ method: "getProjects", args });
      return script.getProjects ?? { ok: false, reason: "unreachable" };
    },
    reportFingerprint: async (...args) => {
      calls.push({ method: "reportFingerprint", args });
      return script.reportFingerprint ?? { ok: false, reason: "unreachable" };
    },
    requestException: async (...args) => {
      calls.push({ method: "requestException", args });
      return script.requestException ?? { ok: false, reason: "unreachable" };
    },
    listExceptions: async (...args) => {
      calls.push({ method: "listExceptions", args });
      return script.listExceptions ?? { ok: false, reason: "unreachable" };
    },
    getException: async (...args) => {
      calls.push({ method: "getException", args });
      return script.getException ?? { ok: false, reason: "unreachable" };
    },
    validateException: async (...args) => {
      calls.push({ method: "validateException", args });
      return script.validateException ?? { ok: false, reason: "unreachable" };
    },
    sendEvents: async (...args) => {
      calls.push({ method: "sendEvents", args });
      const scripted = script.sendEvents;
      if (typeof scripted === "function") return scripted(args[1]);
      return scripted ?? { ok: false, reason: "unreachable" };
    },
  };
}

// ---- Event spool ---------------------------------------------------------------------------------------------

export interface MemorySpool extends EventSpool {
  readonly items: Map<string, SecurityEventInput>;
}

export function memorySpool(initial: SecurityEventInput[] = []): MemorySpool {
  const items = new Map(initial.map((e) => [e.idempotencyKey, e]));
  let dropped = 0;
  return {
    items,
    add: async (event) => void items.set(event.idempotencyKey, event),
    peek: async (limit) => [...items.values()].slice(0, limit).map((event) => ({ key: event.idempotencyKey, event })),
    remove: async (keys) => void keys.forEach((k) => items.delete(k)),
    discard: async (keys) => {
      for (const k of keys) if (items.delete(k)) dropped += 1;
    },
    stats: async () => ({ pending: items.size, dropped }),
  };
}
