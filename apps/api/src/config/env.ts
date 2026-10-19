import { z } from "zod";

const positiveInt = (fallback: number): z.ZodType<number> =>
  z.coerce.number().int().positive().default(fallback);

/** An env var that may be absent or left blank (`SMTP_USER=`); blank means unset. */
const optionalString = (): z.ZodType<string | undefined> =>
  z.string().optional().transform((v) => (v === undefined || v.trim() === "" ? undefined : v));

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).refine((v) => /^postgres(ql)?:\/\//.test(v), "must be a postgres:// URL"),
  JWT_SECRET: z.string().min(32),
  DASHBOARD_BASE_URL: z.url(),
  SESSION_TTL_MINUTES: positiveInt(60),
  ENROLLMENT_TOKEN_TTL_MINUTES: positiveInt(30),
  EXCEPTION_MAX_TTL_HOURS: positiveInt(72),
  THROTTLE_TTL_SECONDS: positiveInt(60),
  THROTTLE_LIMIT: positiveInt(120),
  /** Requests per window for login and enrollment (brute-force protection). */
  AUTH_THROTTLE_LIMIT: positiveInt(10),
  /**
   * Reverse proxies in front of the API whose X-Forwarded-For is trusted (0 = none, the default). Behind nginx in compose
   * this is 1; without it every client shares the proxy's address and therefore one throttle bucket. Never set it
   * higher than the real number of proxies: callers could then spoof the address used for rate limiting.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** Email alerts are off when SMTP_HOST is unset or empty. */
  SMTP_HOST: optionalString(),
  SMTP_PORT: positiveInt(1025),
  SMTP_USER: optionalString(),
  SMTP_PASSWORD: optionalString(),
  SMTP_FROM: z.string().min(1).default("devguard@localhost"),
});
export type Env = z.infer<typeof EnvSchema>;

export type EnvResult = { readonly ok: true; readonly env: Env } | { readonly ok: false; readonly problems: readonly string[] };

/** Validates raw environment values. Problems name the variable only, never its value (JWT_SECRET, DATABASE_URL). */
export function parseEnv(raw: Readonly<Record<string, string | undefined>>): EnvResult {
  const parsed = EnvSchema.safeParse(raw);
  if (parsed.success) return { ok: true, env: parsed.data };
  const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`);
  return { ok: false, problems };
}
