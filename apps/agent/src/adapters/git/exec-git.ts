import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { AgentError } from "../../errors.js";
import type { AddedLineRecord, CommitBaseline, CommitList, GitPort } from "../../ports/git.js";
import { parseAddedLines, parseNameStatusZ } from "./diff-parse.js";

const NAME_STATUS_MAX_BYTES = 16 * 1024 * 1024;
const PATCH_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

interface RunOptions {
  readonly cwd?: string;
  readonly maxBytes?: number;
  /** Exit codes that are answers rather than failures (e.g. `config --get` exits 1 when the key is unset). */
  readonly okCodes?: readonly number[];
  /** Extra environment for this one command. */
  readonly env?: Record<string, string>;
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
}

function run(args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const okCodes = options.okCodes ?? [0];
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      {
        cwd: options.cwd ?? process.cwd(),
        maxBuffer: options.maxBytes ?? DEFAULT_MAX_BYTES,
        encoding: "utf8",
        env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
      },
      (error, stdout) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
        if (okCodes.includes(code)) {
          resolve({ code, stdout });
          return;
        }
        // Never include stdout/stderr: a failing diff command could carry file contents.
        const tooLarge = (error as NodeJS.ErrnoException | null)?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        reject(new AgentError("git_failed", tooLarge ? `git ${args[0] ?? ""} produced more output than the safety limit.` : `git ${args[0] ?? ""} failed.`, { cause: error }));
      },
    );
  });
}

const trimEnd = (text: string): string => text.replace(/\n$/, "");

/**
 * `GitPort` over the `git` executable. Arguments are passed as an array: no shell, no string building. Commands that
 * name no repository run in `options.cwd` (default: the process's directory, which is the repository inside a Git hook).
 */
export function createGit(options: { cwd?: string } = {}): GitPort {
  const base = options.cwd;
  const exec = (args: readonly string[], o: RunOptions = {}): Promise<RunResult> => run(args, base === undefined || o.cwd !== undefined ? o : { ...o, cwd: base });
  const inRepo = (repoPath: string): readonly string[] => ["-C", repoPath];

  async function configGet(scope: readonly string[], key: string, repoPath?: string): Promise<string | undefined> {
    const prefix = repoPath === undefined ? [] : inRepo(repoPath);
    const { code, stdout } = await exec([...prefix, "config", ...scope, "--get", key], { okCodes: [0, 1] });
    return code === 1 ? undefined : trimEnd(stdout);
  }

  return {
    globalConfigGet: (key) => configGet(["--global"], key),
    globalConfigSet: async (key, value) => void (await exec(["config", "--global", key, value])),
    globalConfigUnset: async (key) => void (await exec(["config", "--global", "--unset", key], { okCodes: [0, 5] })),
    localConfigGet: (repoPath, key) => configGet(["--local"], key, repoPath),

    async repoRoot(cwd) {
      const top = await exec(["rev-parse", "--show-toplevel"], { cwd, okCodes: [0, 128] });
      if (top.code === 0) return trimEnd(top.stdout);
      const dir = await exec(["rev-parse", "--absolute-git-dir"], { cwd, okCodes: [0, 128] });
      return dir.code === 0 ? trimEnd(dir.stdout) : undefined;
    },

    async mainWorktreeRoot(cwd) {
      const common = await exec(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, okCodes: [0, 128] });
      if (common.code !== 0) return undefined;
      const dir = await realpath(trimEnd(common.stdout)).catch(() => trimEnd(common.stdout));
      return basename(dir) === ".git" ? dirname(dir) : dir; // a bare repository is its own root
    },

    async effectiveHooksDir(repoPath) {
      const { stdout } = await exec([...inRepo(repoPath), "rev-parse", "--path-format=absolute", "--git-path", "hooks"]);
      return trimEnd(stdout);
    },

    async defaultHooksDir(repoPath) {
      const { stdout } = await exec([...inRepo(repoPath), "rev-parse", "--path-format=absolute", "--git-common-dir"]);
      return `${trimEnd(stdout)}/hooks`;
    },

    async rootCommits(cwd) {
      // Replace refs can rewrite history locally (grafting a fake parent onto the root): ignore them so the
      // fingerprint is the real first commit. (A shallow clone's boundary still reads as a root: documented, AG-4.)
      const { stdout } = await exec(["rev-list", "--max-parents=0", "--exclude=refs/replace/*", "--all"], { cwd, env: { GIT_NO_REPLACE_OBJECTS: "1" } });
      return [...new Set(stdout.split("\n").filter((line) => SHA.test(line)))];
    },

    async remoteUrls(cwd) {
      const { stdout: names } = await exec(["remote"], { cwd });
      const urls = new Set<string>();
      for (const name of names.split("\n").filter((n) => n !== "")) {
        for (const push of [[], ["--push"]]) {
          const { stdout } = await exec(["remote", "get-url", ...push, "--all", "--", name], { cwd });
          for (const url of stdout.split("\n")) if (url !== "") urls.add(url);
        }
      }
      return [...urls];
    },

    async objectExists(sha) {
      if (!SHA.test(sha)) return false;
      return (await exec(["cat-file", "-e", sha], { okCodes: [0, 1, 128] })).code === 0;
    },

    async peeledObjectType(sha) {
      if (!SHA.test(sha)) return undefined;
      const { code, stdout } = await exec(["cat-file", "-t", `${sha}^{}`], { okCodes: [0, 128] });
      return code === 0 ? trimEnd(stdout) : undefined;
    },

    async isAncestor(ancestor, descendant) {
      if (!SHA.test(ancestor) || !SHA.test(descendant)) return false;
      return (await exec(["merge-base", "--is-ancestor", ancestor, descendant], { okCodes: [0, 1, 128] })).code === 0;
    },

    async listCommits(localSha, baseline: CommitBaseline, limit): Promise<CommitList> {
      if (!SHA.test(localSha)) throw new AgentError("git_failed", "Invalid commit id.");
      const range =
        baseline.kind === "commit"
          ? [`${baseline.sha}..${localSha}`]
          : [localSha, "--not", `--remotes=${baseline.name}`];
      if (baseline.kind === "commit" && !SHA.test(baseline.sha)) throw new AgentError("git_failed", "Invalid commit id.");
      const { stdout } = await exec(["rev-list", `--max-count=${limit + 1}`, ...range]);
      const commits = stdout.split("\n").filter((line) => SHA.test(line));
      return { commits: commits.slice(0, limit), truncated: commits.length > limit };
    },

    async changedPaths(commit) {
      if (!SHA.test(commit)) throw new AgentError("git_failed", "Invalid commit id.");
      const { stdout } = await exec(
        ["diff-tree", "--no-commit-id", "-r", "-z", "--name-status", "--no-renames", "--root", "-m", "--no-ext-diff", commit],
        { maxBytes: NAME_STATUS_MAX_BYTES },
      );
      return parseNameStatusZ(stdout);
    },

    async addedLines(commit): Promise<AddedLineRecord[]> {
      if (!SHA.test(commit)) throw new AgentError("git_failed", "Invalid commit id.");
      // -a (treat every file as text): Git would otherwise print "Binary files differ" for any file with a NUL byte or a
      // `-diff` attribute (which the pusher controls), and the secret scan would see nothing.
      // --no-ext-diff/--no-textconv: repository config must not be able to make the hook run programs.
      const { stdout } = await exec(
        ["diff-tree", "--no-commit-id", "-r", "-p", "-U0", "-a", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--root", "-m", "--no-prefix", commit],
        { maxBytes: PATCH_MAX_BYTES },
      );
      return parseAddedLines(stdout);
    },
  };
}
