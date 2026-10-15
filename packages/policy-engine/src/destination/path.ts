import { fail, ok, type Result } from "../result.js";

export type PathReason = "invalid_path";

const SEGMENT = /^[A-Za-z0-9._~-]+$/;
const MAX_PATH_LENGTH = 512;
const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 10;

/** Hosts whose owner/repo paths are case-insensitive. Elsewhere case is preserved (a different case may be a different repo). */
const CASE_INSENSITIVE_HOSTS: ReadonlySet<string> = new Set(["github.com", "gitlab.com", "bitbucket.org", "dev.azure.com"]);

export function hostIsCaseInsensitive(host: string): boolean {
  return CASE_INSENSITIVE_HOSTS.has(host);
}

/**
 * Canonicalise a repository path (`owner/repo`, optionally nested groups).
 * Removes one leading slash (scp-style absolute form), one trailing slash and one `.git` suffix; rejects empty,
 * `.`/`..` and oddly-charactered segments, and paths with fewer than two segments.
 */
export function normalizeRepoPath(rawPath: string, host: string): Result<string, PathReason> {
  let path = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
  if (path.endsWith("/")) path = path.slice(0, -1);
  // Fold case first (only on case-insensitive hosts) so `.GIT` is stripped exactly where `Repo` == `repo`.
  if (hostIsCaseInsensitive(host)) path = path.toLowerCase();
  if (path.endsWith(".git") && path.length > 4) path = path.slice(0, -4);

  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return fail("invalid_path");

  const segments = path.split("/");
  if (segments.length < MIN_SEGMENTS || segments.length > MAX_SEGMENTS) return fail("invalid_path");
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment === "." || segment === "..") return fail("invalid_path");
  }

  return ok(path);
}
