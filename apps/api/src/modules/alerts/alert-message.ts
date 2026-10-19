import type { SecurityEventInput } from "@devguard/shared";
import type { AlertReason } from "./alert-rules.js";
import type { MailMessage } from "./mail-sender.js";

export interface AlertContext {
  readonly reason: AlertReason;
  readonly event: SecurityEventInput;
  readonly projectName: string | null;
  readonly userName: string;
  readonly deviceName: string;
  readonly dashboardEventsUrl: string;
}

const HEADLINE: Record<AlertReason, string> = {
  blocked_push: "A push was blocked",
  high_severity: "A high-severity push event was recorded",
};

const MAX_FIELD_LENGTH = 100;

/**
 * Makes agent- or admin-supplied text safe for one line of plain text: control characters, Unicode line/paragraph
 * separators and bidi overrides become spaces, and long values are cut.
 */
const clean = (value: string): string => {
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ").trim();
  return flat.length > MAX_FIELD_LENGTH ? `${flat.slice(0, MAX_FIELD_LENGTH)}...` : flat;
};

/**
 * Metadata only (ADR-009, ADR-005): who, where, which rules, what the hook decided. Never findings, file paths,
 * file contents or secret values. The mail says the hook observed a push attempt, not that data was or was not leaked.
 */
export function buildAlertMessage(context: AlertContext, recipients: readonly string[]): MailMessage {
  const { event, reason } = context;
  const destination = event.destination === null ? "unknown (could not be parsed)" : `${event.destination.host}/${event.destination.repoPath}`;
  const project = context.projectName ?? "unmatched repository";
  const lines = [
    `${HEADLINE[reason]}.`,
    "",
    `Project:     ${clean(project)}`,
    `Employee:    ${clean(context.userName)}`,
    `Device:      ${clean(context.deviceName)}`,
    `Destination: ${clean(destination)}`,
    `Operation:   ${event.operation}`,
    `Outcome:     ${event.outcome}${event.mode === null ? "" : ` (${event.mode})`}`,
    `Rules:       ${event.ruleIds.length === 0 ? "none" : event.ruleIds.join(", ")}`,
    `Occurred:    ${event.occurredAt}`,
    "",
    `Details: ${context.dashboardEventsUrl}`,
    "",
    "This notice says the DevGuard hook observed a push attempt and what it decided. It does not show whether data was or was not exfiltrated.",
  ];
  return { to: recipients, subject: `[DevGuard] ${HEADLINE[reason]}: ${clean(project)}`, text: lines.join("\n") };
}
