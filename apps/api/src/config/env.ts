import { z } from "zod";

const positiveInt = (fallback: number): z.ZodType<number> =>
  z.coerce.number().int().positive().default(fallback);

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
