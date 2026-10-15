import type { ApprovedDestination, NormalizedDestination } from "@devguard/shared";
import { normalizeHostPort } from "./host.js";
import { normalizeDestination } from "./normalize.js";
import { normalizeRepoPath } from "./path.js";

export interface ApprovalMatch {
  readonly approved: boolean;
  readonly matchedEntryId?: string;
}

const NOT_APPROVED: ApprovalMatch = { approved: false };

/**
 * Is `destination` covered by the allowlist?
 *
 * Comparison is exact on canonical host and whole path segments: never substring, prefix-of-string or suffix
 * matching. Entries are re-canonicalised through the same normaliser so a sloppily stored entry cannot match more
 * than it should; an entry that fails to normalise matches nothing.
 */
export function isApproved(
  destination: NormalizedDestination,
  allowlist: readonly ApprovedDestination[],
): ApprovalMatch {
  for (const entry of allowlist) {
    const canonical = canonicaliseEntry(entry);
    if (!canonical) continue;
    if (canonical.host !== destination.host) continue;
    if (matchesPath(entry.type, canonical.repoPath, destination.repoPath)) {
      return entry.id === undefined ? { approved: true } : { approved: true, matchedEntryId: entry.id };
    }
  }
  return NOT_APPROVED;
}

/** Convenience for callers holding the raw remote URL: unparsable input is never approved. */
export function isRawDestinationApproved(raw: unknown, allowlist: readonly ApprovedDestination[]): ApprovalMatch {
  const parsed = normalizeDestination(raw);
  return parsed.ok ? isApproved(parsed.value, allowlist) : NOT_APPROVED;
}

function canonicaliseEntry(entry: ApprovedDestination): NormalizedDestination | null {
  // Entries are already canonical host[:port] values, so no scheme-based default-port dropping is applied.
  const host = normalizeHostPort(entry.host, "none");
  if (!host.ok) return null;
  const bareHost = host.value.split(":")[0] ?? host.value;

  // owner_wildcard entries may be a single segment (the owner), which a full repo path never is.
  const probe = entry.type === "owner_wildcard" ? `${entry.repoPath}/x` : entry.repoPath;
  const path = normalizeRepoPath(probe, bareHost);
  if (!path.ok) return null;

  const repoPath = entry.type === "owner_wildcard" ? path.value.split("/").slice(0, -1).join("/") : path.value;
  return { host: host.value, repoPath };
}

/**
 * `exact`: full path equality. `owner_wildcard`: the entry is an owner/group prefix and the destination must be
 * strictly deeper under it, compared by whole segments (nested groups such as GitLab `group/sub/repo` match a
 * `group` entry). Any other `type` matches nothing, so unvalidated input fails closed.
 */
function matchesPath(type: ApprovedDestination["type"], entryPath: string, destPath: string): boolean {
  if (type === "exact") return entryPath === destPath;
  if (type !== "owner_wildcard") return false;
  const entrySegments = entryPath.split("/");
  const destSegments = destPath.split("/");
  return (
    destSegments.length > entrySegments.length && entrySegments.every((segment, index) => segment === destSegments[index])
  );
}
