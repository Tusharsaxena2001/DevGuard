import { fail, ok, type Result } from "../result.js";

export type HostReason = "invalid_host" | "invalid_port";

const MAX_HOST_LENGTH = 253;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const DEFAULT_PORTS: Readonly<Record<string, number>> = { https: 443, ssh: 22 };

/**
 * Validate and canonicalise `host[:port]`.
 * Lowercases, drops one trailing dot, rejects IPv6 literals, empty/odd labels, and invalid ports.
 * A port is kept (as `host:port`) only when it is not the scheme's default, because a different port is a
 * different server. Scheme `"none"` (used for already-canonical allowlist entries) never drops a port.
 */
export function normalizeHostPort(hostPort: string, scheme: "https" | "ssh" | "none"): Result<string, HostReason> {
  if (hostPort.includes("[") || hostPort.includes("]")) return fail("invalid_host");

  const parts = hostPort.split(":");
  if (parts.length > 2) return fail("invalid_host");
  const rawHost = parts[0] ?? "";
  const rawPort = parts[1];

  let host = rawHost.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.length === 0 || host.length > MAX_HOST_LENGTH) return fail("invalid_host");
  if (!host.split(".").every((label) => LABEL.test(label))) return fail("invalid_host");

  if (rawPort === undefined) return ok(host);
  if (!/^[1-9][0-9]{0,4}$/.test(rawPort)) return fail("invalid_port");
  const port = Number(rawPort);
  if (port > 65535) return fail("invalid_port");
  return ok(port === DEFAULT_PORTS[scheme] ? host : `${host}:${port}`);
}
