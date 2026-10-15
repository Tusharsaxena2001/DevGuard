import type { Finding, RefUpdate } from "@devguard/shared";
import { findProhibitedFiles, scanAddedLines, type AddedLine, type FileRef } from "@devguard/policy-engine";
import type { GitPort } from "../ports/git.js";
import { isDeletion } from "./parse-push-input.js";

export const MAX_COMMITS = 2000;

const SCAN_ERROR = "scan_error";
const UNSCANNED_COMMIT = "(commit could not be scanned)";
const TOO_MANY_COMMITS = "(too many commits to scan)";
const NOT_A_COMMIT = "(pushed object is not a commit)";

export interface OutgoingScan {
  readonly commitCount: number;
  readonly findings: Finding[];
  /** Per ref: did Git say the remote ref is not an ancestor of what is being pushed? */
  readonly forcePush: ReadonlyMap<string, boolean>;
}

/**
 * Inspect the commits a push would send. Each commit is inspected on its own, so a secret added and removed again
 * within the pushed range is still found (the adding commit is flagged). Deleted files are not passed to the
 * file-name rule: the commit that removes a `.env` is the fix, and the commit that added it is flagged itself.
 * Failures are findings (`scan_error`), never silence: the policy decides what a scan error means.
 */
export async function scanOutgoing(
  git: GitPort,
  refs: readonly RefUpdate[],
  remoteName: string,
  secretRuleIds: readonly string[],
  prohibitedGlobs: readonly string[],
): Promise<OutgoingScan> {
  const findings: Finding[] = [];
  const forcePush = new Map<string, boolean>();
  const commits = new Set<string>();

  for (const ref of refs) {
    if (isDeletion(ref)) continue;
    // A ref can point at a blob or tree (e.g. a tag on a file). `rev-list` yields no commits for it, so it would be
    // "scanned" as empty: report it instead, which blocks in enforce mode.
    if ((await git.peeledObjectType(ref.localSha)) !== "commit") {
      findings.push({ ruleId: SCAN_ERROR, kind: "scan_error", path: NOT_A_COMMIT, commit: ref.localSha });
      continue;
    }
    const remoteKnown = ref.kind === "update" && (await git.objectExists(ref.remoteSha));
    const baseline = remoteKnown ? ({ kind: "commit", sha: ref.remoteSha } as const) : ({ kind: "remote", name: remoteName } as const);
    forcePush.set(ref.remoteRef, ref.kind === "update" && !(remoteKnown && (await git.isAncestor(ref.remoteSha, ref.localSha))));

    const list = await git.listCommits(ref.localSha, baseline, MAX_COMMITS);
    for (const commit of list.commits) commits.add(commit);
    if (list.truncated) findings.push({ ruleId: SCAN_ERROR, kind: "scan_error", path: TOO_MANY_COMMITS, commit: ref.localSha });
  }

  const files: FileRef[] = [];
  const lines: AddedLine[] = [];
  for (const commit of commits) {
    try {
      for (const change of await git.changedPaths(commit)) if (change.status !== "D") files.push({ path: change.path, commit });
      if (secretRuleIds.length > 0) {
        for (const added of await git.addedLines(commit)) lines.push({ path: added.path, commit, text: added.text, line: added.line });
      }
    } catch {
      findings.push({ ruleId: SCAN_ERROR, kind: "scan_error", path: UNSCANNED_COMMIT, commit });
    }
  }

  findings.push(...findProhibitedFiles(files, prohibitedGlobs), ...scanAddedLines(lines, secretRuleIds));
  return { commitCount: commits.size, findings, forcePush };
}
