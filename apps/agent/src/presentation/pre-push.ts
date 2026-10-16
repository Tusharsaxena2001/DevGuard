import type { Classification, Decision, EnforcementMode, Finding } from "@devguard/shared";

import { safeText } from "../safe-text.js";

const MAX_FINDINGS_SHOWN = 15;
export { safeText };

const KIND_LABEL: Record<Finding["kind"], string> = {
  secret: "secret",
  prohibited_file: "prohibited file",
  scan_error: "scan error",
};

function describeFinding(finding: Finding): string {
  const where = `${safeText(finding.path)}${finding.line === undefined ? "" : `:${finding.line}`}`;
  const commit = finding.commit === undefined ? "" : ` (commit ${finding.commit.slice(0, 7)})`;
  return `    ${KIND_LABEL[finding.kind]}: ${safeText(finding.ruleId)}  ${where}${commit}`;
}

export interface DecisionView {
  readonly decision: Decision;
  readonly projectName: string;
  readonly classification: Classification;
  readonly mode: EnforcementMode;
  readonly destination: { readonly host: string; readonly repoPath: string } | null;
  readonly forcePushRefs: readonly string[];
  readonly correlationId: string;
  /** For the ready-made `request-exception` command. */
  readonly projectId?: string;
  /** An exception may exist but the server could not be asked (offline): say so (ADR-004). */
  readonly exceptionUnavailable?: boolean;
}

/** Human explanation of a decision. Silent (no lines) for a clean allow. Never includes the raw remote URL or any matched text. */
export function formatDecision(view: DecisionView): string[] {
  const { decision } = view;
  if (decision.outcome === "allowed" && decision.violatedRuleIds.length === 0) return [];
  if (decision.outcome === "exception") {
    return [`DevGuard: allowed by approved exception ${safeText(decision.exceptionId ?? "")}.`];
  }
  if (decision.outcome === "error") {
    return formatCannotCheck("DevGuard hit an internal error while checking this push.", view.mode === "audit_only" ? "allowed" : "blocked", view.correlationId);
  }

  const blocked = decision.outcome === "blocked";
  const destination = view.destination ? `${view.destination.host}/${view.destination.repoPath}` : "could not be parsed (treated as not approved)";
  const lines = [
    blocked ? "DevGuard blocked this push." : "DevGuard (audit-only): this push would be blocked in enforce mode. It was allowed and recorded.",
    `  Project: ${safeText(view.projectName)} (${view.classification}, ${view.mode})`,
    `  Destination: ${safeText(destination)}`,
    "  Why:",
    ...decision.reasons.map((reason) => `    - ${reason}`),
  ];
  if (view.forcePushRefs.length > 0) lines.push(`  Note: a force-push (not a fast-forward) was detected for ${view.forcePushRefs.map(safeText).join(", ")}.`);
  if (decision.findings.length > 0) {
    lines.push("  Details:", ...decision.findings.slice(0, MAX_FINDINGS_SHOWN).map(describeFinding));
    if (decision.findings.length > MAX_FINDINGS_SHOWN) lines.push(`    ...and ${decision.findings.length - MAX_FINDINGS_SHOWN} more`);
  }
  if (blocked) {
    lines.push(
      "  Next: push to an approved destination, or remove the flagged content from the commits you are pushing (it stays in history until the commits are rewritten), or ask for an exception.",
    );
    if (view.exceptionUnavailable === true) {
      lines.push("  Note: an approved exception could not be checked because the DevGuard server is unreachable; exceptions only work while it is.");
    }
    if (view.destination !== null && view.projectId !== undefined && decision.violatedRuleIds.includes("destination_not_approved")) {
      lines.push(`  To ask for an exception to this destination:`, `    devguard request-exception --project ${safeText(view.projectId)} --destination ${safeText(`https://${view.destination.host}/${view.destination.repoPath}`)} --reason "why you need it"`);
    }
  }
  lines.push(`  Reference: ${view.correlationId}`);
  return lines;
}

/** The hook could not tell whether the push is allowed. */
export function formatCannotCheck(reason: string, result: "blocked" | "allowed", correlationId: string): string[] {
  return [
    result === "blocked" ? "DevGuard blocked this push because it could not check it." : "DevGuard (audit-only): could not fully check this push. It was allowed and recorded.",
    `  Reason: ${reason}`,
    "  Run 'devguard status' to see what is wrong.",
    `  Reference: ${correlationId}`,
  ];
}

export interface PolicyExpiredView {
  readonly projectName: string;
  readonly mode: EnforcementMode;
  readonly maxStaleMinutes: number;
  readonly blocked: boolean;
  readonly correlationId: string;
}

/** The saved policy is too old to trust and the server could not refresh it (ADR-004). */
export function formatPolicyExpired(view: PolicyExpiredView): string[] {
  return [
    view.blocked
      ? "DevGuard blocked this push: its saved policy for this project is out of date and the server could not be reached."
      : "DevGuard (audit-only): the saved policy for this project is out of date and the server could not be reached. The push was allowed and recorded.",
    `  Project: ${safeText(view.projectName)} (${view.mode})`,
    `  Why: policies are only trusted for ${view.maxStaleMinutes} minutes without contact with the DevGuard server.`,
    view.blocked ? "  Next: reconnect (VPN or network) and run 'devguard sync', then push again." : "  Next: run 'devguard sync' when you are back online.",
    `  Reference: ${view.correlationId}`,
  ];
}
