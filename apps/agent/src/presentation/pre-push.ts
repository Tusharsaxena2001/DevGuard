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
      "  Next: push to an approved destination, or remove the flagged content from the commits you are pushing (it stays in history until the commits are rewritten), or ask the project owner for an exception.",
    );
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
