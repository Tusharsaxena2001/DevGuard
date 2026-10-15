import type { NormalizedDestination } from "@devguard/shared";
import { fail, ok, type Result } from "../result.js";
import { normalizeHostPort, type HostReason } from "./host.js";
import { normalizeRepoPath, type PathReason } from "./path.js";

export type NormalizeReason =
  | HostReason
  | PathReason
  | "invalid_type"
  | "empty"
  | "too_long"
  | "non_ascii"
  | "invalid_characters"
  | "percent_encoding"
  | "query_or_fragment"
  | "unsupported_scheme"
  | "local_path"
  | "multiple_at"
  | "credentials_in_url"
  | "invalid_userinfo"
  | "missing_path";

export type NormalizeResult = Result<NormalizedDestination, NormalizeReason>;

const MAX_INPUT_LENGTH = 2048;
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
// Must start alphanumeric: a leading '-' could be read as an option by ssh/git.
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const URL_FORM = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/;
const SCP_FORM = /^([^@:/]+)@([^@:/]+):(.*)$/;

const SCHEME_TO_KIND: Readonly<Record<string, "https" | "ssh">> = { https: "https", ssh: "ssh" };

/**
 * Normalize a Git remote URL (HTTPS, `ssh://`, or scp-style `user@host:owner/repo`) into host + repo path.
 *
 * Fail-safe by design: anything unusual is rejected, and callers must treat `ok: false` as "not approved".
 * Never throws. Input credentials are never echoed back in results.
 */
export function normalizeDestination(raw: unknown): NormalizeResult {
  if (typeof raw !== "string") return fail("invalid_type");

  const input = raw.trim();
  if (input.length === 0) return fail("empty");
  if (input.length > MAX_INPUT_LENGTH) return fail("too_long");

  const charProblem = checkCharacters(input);
  if (charProblem) return fail(charProblem);

  return input.includes("://") ? parseUrlForm(input) : parseScpForm(input);
}

function checkCharacters(input: string): NormalizeReason | null {
  if (!PRINTABLE_ASCII.test(input)) {
    // Non-ASCII (e.g. homoglyph hosts) is rejected outright rather than mapped to punycode.
    return /[^\x00-\x7f]/.test(input) ? "non_ascii" : "invalid_characters";
  }
  if (input.includes("\\")) return "invalid_characters";
  if (input.includes("%")) return "percent_encoding";
  if (input.includes("?") || input.includes("#")) return "query_or_fragment";
  return null;
}

function parseUrlForm(input: string): NormalizeResult {
  const match = URL_FORM.exec(input);
  if (!match) return fail("unsupported_scheme");

  const kind = SCHEME_TO_KIND[(match[1] ?? "").toLowerCase()];
  if (!kind) return fail("unsupported_scheme");

  const authority = match[2] ?? "";
  const path = match[3];
  if (path === undefined) return fail("missing_path");

  const hostPort = splitUserinfo(authority);
  if (!hostPort.ok) return fail(hostPort.reason);

  return finish(hostPort.value, path, kind);
}

function parseScpForm(input: string): NormalizeResult {
  const match = SCP_FORM.exec(input);
  if (!match) {
    return /^[./~]/.test(input) ? fail("local_path") : fail("unsupported_scheme");
  }
  const [, username = "", host = "", path = ""] = match;
  if (!USERNAME.test(username)) return fail("invalid_userinfo");
  return finish(host, path, "ssh");
}

/** Returns `host[:port]` after validating (and discarding) any username. Passwords and host-like usernames are rejected. */
function splitUserinfo(authority: string): Result<string, NormalizeReason> {
  const atCount = authority.split("@").length - 1;
  if (atCount === 0) return ok(authority);
  if (atCount > 1) return fail("multiple_at");

  const [userinfo = "", hostPort = ""] = authority.split("@");
  if (userinfo.includes(":")) return fail("credentials_in_url");
  if (!USERNAME.test(userinfo)) return fail("invalid_userinfo");
  return ok(hostPort);
}

function finish(hostPort: string, rawPath: string, kind: "https" | "ssh"): NormalizeResult {
  const host = normalizeHostPort(hostPort, kind);
  if (!host.ok) return fail(host.reason);

  // Case rules depend on the host without its port.
  const bareHost = host.value.split(":")[0] ?? host.value;
  const repoPath = normalizeRepoPath(rawPath, bareHost);
  if (!repoPath.ok) return fail(repoPath.reason);

  return ok({ host: host.value, repoPath: repoPath.value });
}
