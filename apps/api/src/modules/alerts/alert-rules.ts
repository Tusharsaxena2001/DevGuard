import type { SecurityEventInput } from "@devguard/shared";

export type AlertReason = "blocked_push" | "high_severity";

const HIGH_SEVERITY_RULES: ReadonlySet<string> = new Set(["secret_detected", "scan_error"]);

/**
 * Why this event deserves an email, or null when it does not (ADR-009 subset). Audit-only events never alert: they
 * record what would have happened, not something that was stopped. A block outranks the severity label.
 */
export function alertReason(event: Pick<SecurityEventInput, "outcome" | "mode" | "ruleIds">): AlertReason | null {
  if (event.mode === "audit_only") return null;
  if (event.outcome === "blocked" && event.mode === "enforce") return "blocked_push";
  if (event.ruleIds.some((r) => HIGH_SEVERITY_RULES.has(r))) return "high_severity";
  return null;
}
