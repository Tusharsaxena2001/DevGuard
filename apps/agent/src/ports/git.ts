import type { ChangedFileStatus } from "./git-types.js";

/** Where to start counting "new" commits for a ref being pushed. */
export type CommitBaseline =
  /** The remote ref currently points at this commit (known locally): scan `sha..local`. */
  | { readonly kind: "commit"; readonly sha: string }
  /** Unknown or new on the remote: scan everything not reachable from this remote's tracking refs. */
  | { readonly kind: "remote"; readonly name: string };

export interface CommitList {
  readonly commits: string[];
  /** More commits exist than the requested limit. */
  readonly truncated: boolean;
}

export interface AddedLineRecord {
  readonly path: string;
  /** Line number in the new file. */
  readonly line: number;
  readonly text: string;
}

/**
 * Everything the agent needs from Git, and the only way it talks to Git (no shell; arguments are never joined into
 * a command string). Failures throw `AgentError("git_failed")`; messages never include file contents.
 */
export interface GitPort {
  // Configuration and hook locations (AG-2)
  globalConfigGet(key: string): Promise<string | undefined>;
  globalConfigSet(key: string, value: string): Promise<void>;
  globalConfigUnset(key: string): Promise<void>;
  localConfigGet(repoPath: string, key: string): Promise<string | undefined>;
  /** Top level of the work tree (or the git dir of a bare repo) containing `cwd`; undefined outside a repository. */
  repoRoot(cwd: string): Promise<string | undefined>;
  /**
   * Root of the repository's main work tree (for a linked worktree, the main checkout), as a real path. Registrations
   * name the main checkout, so a worktree of a registered repository must be recognised through it.
   */
  mainWorktreeRoot(cwd: string): Promise<string | undefined>;
  /** The hooks directory Git would actually use (honours `core.hooksPath`), absolute. */
  effectiveHooksDir(repoPath: string): Promise<string>;
  /** `<git-common-dir>/hooks`, absolute (works for worktrees). */
  defaultHooksDir(repoPath: string): Promise<string>;

  // Repository identity (AG-4)
  /**
   * Root commits of every local ref (`rev-list --max-parents=0 --all`): the repo's fingerprints, stable however its
   * remotes are rewired. Empty for a repo with no commits. A repo with several roots yields them all.
   */
  rootCommits(cwd: string): Promise<string[]>;
  /** Every configured fetch and push URL of every remote, after `insteadOf` rewriting. Possibly empty. */
  remoteUrls(cwd: string): Promise<string[]>;

  // Outgoing-change inspection (AG-3)
  objectExists(sha: string): Promise<boolean>;
  /** Type of the object after peeling annotated tags (`commit`, `tree`, `blob`), or undefined if it cannot be determined. */
  peeledObjectType(sha: string): Promise<string | undefined>;
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;
  listCommits(localSha: string, baseline: CommitBaseline, limit: number): Promise<CommitList>;
  /** Paths touched by one commit relative to its parent(s), with the kind of change. */
  changedPaths(commit: string): Promise<ChangedFileStatus[]>;
  /** Lines added by one commit. Text is input for the secret detector only and must not be stored or logged. */
  addedLines(commit: string): Promise<AddedLineRecord[]>;
}
