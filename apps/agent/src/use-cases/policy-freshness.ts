export type Freshness = "fresh" | "stale_ok" | "expired" | "missing";

export const DEFAULT_MAX_STALE_MINUTES = 60;
/** Upper bound for the configured limit (24 hours): the environment of whoever pushes cannot keep an old policy alive for years. */
export const MAX_ALLOWED_STALE_MINUTES = 24 * 60;
/** Within this age a policy counts as "fresh" (it was just synced); beyond it, it is merely usable until the limit. */
const FRESH_MINUTES = 5;

/**
 * Parses `DEVGUARD_POLICY_MAX_STALE_MINUTES`. Anything that is not a positive whole number falls back to the default
 * (a typo must never switch the limit off); values above 24 hours are capped.
 */
export function parseMaxStaleMinutes(raw: string | undefined): number {
  if (raw === undefined || !/^[1-9][0-9]{0,6}$/.test(raw.trim())) return DEFAULT_MAX_STALE_MINUTES;
  return Math.min(Number(raw.trim()), MAX_ALLOWED_STALE_MINUTES);
}

/**
 * ADR-004: how usable is a cached server policy right now?
 * - `fresh`: fetched within the last few minutes.
 * - `stale_ok`: older, but within the maximum staleness. Usable when the server cannot be reached.
 * - `expired`: older than the maximum (or a timestamp that cannot be trusted, such as one in the future).
 *   The caller blocks (enforce) or allows and records (audit-only).
 * - `missing`: nothing cached.
 */
export function classifyFreshness(fetchedAt: string | undefined, now: Date, maxStaleMinutes: number): Freshness {
  if (fetchedAt === undefined) return "missing";
  const fetched = Date.parse(fetchedAt);
  if (Number.isNaN(fetched)) return "expired";
  const ageMinutes = (now.getTime() - fetched) / 60_000;
  // A policy "from the future" (clock set back, or a tampered file) cannot prove it is recent.
  if (ageMinutes < -1) return "expired";
  if (ageMinutes <= FRESH_MINUTES) return "fresh";
  return ageMinutes <= maxStaleMinutes ? "stale_ok" : "expired";
}
