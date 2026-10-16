import type { ExceptionEntry } from "@devguard/shared";
import { safeText } from "../safe-text.js";
import type { RequestOutcome, StatusOutcome } from "../use-cases/request-exception.js";

const STATUS_TEXT: Record<ExceptionEntry["status"], string> = {
  pending: "waiting for an administrator",
  approved: "approved",
  rejected: "rejected",
  expired: "expired",
  revoked: "revoked",
};

const describe = (e: ExceptionEntry): string => `${safeText(e.destination.host)}/${safeText(e.destination.repoPath)}`;

/** One request, with the latest decision's reason when there is one. Everything from the server goes through `safeText`. */
export function formatExceptionEntry(entry: ExceptionEntry): string[] {
  const last = entry.decisions.at(-1);
  return [
    `${safeText(entry.id)}  ${safeText(entry.projectName)} -> ${describe(entry)}`,
    `  Status: ${STATUS_TEXT[entry.status]}${entry.status === "approved" && entry.expiresAt !== null ? ` until ${safeText(entry.expiresAt)}` : ""}`,
    ...(last === undefined ? [] : [`  ${last.decision === "approved" ? "Approved" : last.decision === "rejected" ? "Rejected" : "Revoked"} by ${safeText(last.deciderName)}: ${safeText(last.reason)}`]),
  ];
}

export function formatRequested(outcome: Extract<RequestOutcome, { state: "requested" }>): string[] {
  const { entry } = outcome;
  return [
    `Requested an exception for ${safeText(entry.projectName)} to push to ${describe(entry)}.`,
    `  Request id: ${safeText(entry.id)}`,
    "  An administrator has to approve it in the dashboard. Then run your push again.",
    "  Check progress with: devguard exception status",
  ];
}

export function formatNeedsProject(outcome: Extract<RequestOutcome, { state: "needs_project" }>): string[] {
  return outcome.candidates.length === 0
    ? ["DevGuard cannot tell which project this repository belongs to. Add --project <id> (the id is in the block message and in the dashboard)."]
    : ["This repository matches more than one project. Choose one with --project <id>:", ...outcome.candidates.map((c) => `  ${safeText(c.projectId)}  ${safeText(c.name)}`)];
}

export function formatExceptionStatus(outcome: Extract<StatusOutcome, { state: "list" | "one" }>): string[] {
  if (outcome.state === "one") return formatExceptionEntry(outcome.entry);
  return outcome.page.items.length === 0 ? ["You have no exception requests."] : outcome.page.items.flatMap((e) => formatExceptionEntry(e));
}
