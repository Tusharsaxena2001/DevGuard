import type { Env } from "../../config/env.js";

const CENSOR = "[REDACTED]";

/** Paths pino must never write in clear (security.md: no tokens, passwords, Authorization headers, cookies). */
export const REDACT_PATHS: readonly string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "*.authorization",
  "*.cookie",
  "*.token",
  "*.password",
  "*.passwordHash",
  "*.secret",
  "*.deviceSecret",
  "*.secretHash",
  "*.tokenHash",
  "authorization",
  "cookie",
  "token",
  "password",
  "secret",
  "deviceSecret",
];

export interface LoggerOptions {
  readonly level: Env["LOG_LEVEL"];
  readonly redact: { readonly paths: readonly string[]; readonly censor: string };
}

export function createLoggerOptions(env: Pick<Env, "LOG_LEVEL">): LoggerOptions {
  return { level: env.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: CENSOR } };
}
