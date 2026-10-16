import type { DeliveryOutcome } from "../use-cases/deliver-events.js";
import type { SyncOutcome } from "../use-cases/sync-projects.js";
import { FAILURE_TEXT } from "./enroll.js";

/** Lines for every outcome except `failed` (printed as an error from the shared failure text). */
export function formatSync(outcome: Exclude<SyncOutcome, { state: "failed" }>): string[] {
  switch (outcome.state) {
    case "updated":
      return [`Synced ${outcome.projects} project(s) from the server${outcome.removed > 0 ? `; ${outcome.removed} no longer assigned to you was removed` : ""}.`];
    case "unchanged":
      return [`Already up to date (${outcome.projects} project(s)).`];
    case "not_enrolled":
      return ["This device is not enrolled. Run 'devguard enroll --server <url> --token-stdin' first."];
    case "unusable_state":
      return ["DevGuard's local files are unusable. Run 'devguard status' to see what to fix."];
  }
}

/** What happened to queued events; silent when there was nothing to send. */
export function formatDelivery(outcome: DeliveryOutcome): string[] {
  switch (outcome.state) {
    case "delivered":
      return [
        ...(outcome.sent > 0 ? [`Delivered ${outcome.sent} queued event(s) to the server${outcome.remaining > 0 ? `; ${outcome.remaining} still waiting` : ""}.`] : []),
        ...(outcome.refused > 0 ? [`The server refused ${outcome.refused} queued event(s) (for example, you are no longer assigned to their project); they were discarded.`] : []),
      ];
    case "failed":
      return [`${outcome.remaining} event(s) are still queued: ${FAILURE_TEXT[outcome.reason]}`];
    default:
      return [];
  }
}
