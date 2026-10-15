import type { Finding } from "@devguard/shared";
import { compileGlob, isSupportedGlob } from "./glob.js";
import { SCAN_ERROR_RULE_ID } from "./scan.js";

export const PROHIBITED_FILE_RULE_ID = "prohibited_file";

/**
 * Default prohibited-file globs. A `!` prefix exempts matching paths (an exemption always wins over a match).
 * `.npmrc` is a path-only rule: the content is not inspected here, so every `.npmrc` is flagged, not only ones with auth lines.
 */
export const DEFAULT_PROHIBITED_GLOBS: readonly string[] = [
  ".env",
  ".env.*",
  "!.env.example",
  "*.pem",
  "*.key",
  "id_rsa*",
  "id_ed25519*",
  "id_ecdsa*",
  "id_dsa*",
  "!id_*.pub",
  "*.p12",
  "*.pfx",
  ".npmrc",
  "credentials.json",
  "*.kdbx",
];

export interface FileRef {
  readonly path: string;
  readonly commit: string;
}

/**
 * Flag files whose path matches a prohibited glob. One finding per file per commit, regardless of how many globs match.
 * Path-only: file contents are never read. The globs are used exactly as given (an empty list prohibits nothing).
 * Fail-safe: a glob using unsupported syntax would silently never match, so it yields one `scan_error` finding
 * (attributed to the first file) instead of being ignored.
 */
export function findProhibitedFiles(files: readonly FileRef[], globs: readonly string[]): Finding[] {
  const prohibited = globs.filter((g) => !g.startsWith("!")).map(compileGlob);
  const exempt = globs.filter((g) => g.startsWith("!")).map((g) => compileGlob(g.slice(1)));

  const findings: Finding[] = [];
  const first = files[0];
  if (first && globs.some((g) => !isSupportedGlob(g.startsWith("!") ? g.slice(1) : g))) {
    findings.push({ ruleId: SCAN_ERROR_RULE_ID, kind: "scan_error", path: first.path, commit: first.commit });
  }
  const seen = new Set<string>();
  for (const { path, commit } of files) {
    const key = `${commit}\0${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (exempt.some((matches) => matches(path))) continue;
    if (prohibited.some((matches) => matches(path))) {
      findings.push({ ruleId: PROHIBITED_FILE_RULE_ID, kind: "prohibited_file", path, commit });
    }
  }
  return findings;
}
