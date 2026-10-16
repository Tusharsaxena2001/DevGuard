import { safeText } from "../safe-text.js";
import type { ApiFailure } from "../ports/api-client.js";
import type { ServerCheck } from "../use-cases/check-server.js";
import type { EnrollOutcome } from "../use-cases/enroll-device.js";
import { formatGlobalInstall } from "./hooks.js";
import { formatSync } from "./sync.js";

/** One actionable sentence per failure kind. Never contains server-provided text. */
export const FAILURE_TEXT: Record<ApiFailure, string> = {
  unreachable: "Could not reach the DevGuard server. Check the address and your network, then try again.",
  unauthorized: "The server did not accept this device's credentials. Ask your administrator for a new enrollment token and run 'devguard enroll' again.",
  revoked: "This device has been revoked by an administrator. Protected repositories follow the saved policy rules until it is enrolled again.",
  token_invalid: "The enrollment token is invalid, expired or already used. Ask your administrator for a new one.",
  rate_limited: "The server is limiting requests from this device. Wait a minute and try again.",
  server_error: "The DevGuard server had a problem. Try again shortly.",
  rejected: "The server rejected the request. Check that this agent and the server are compatible versions.",
  invalid_response: "The server's reply was not what DevGuard expects. Check the server address.",
  invalid_server_url: "The server URL must be https (http is allowed only for localhost).",
};

export function formatEnroll(outcome: Extract<EnrollOutcome, { ok: true }>): string[] {
  const lines = [
    `Enrolled this device with ${safeText(outcome.serverUrl)} (device id ${safeText(outcome.deviceId)}).`,
    ...(outcome.replacedPrevious ? ["A previous enrollment on this machine was replaced; ask an administrator to revoke the old device record."] : []),
  ];
  if (outcome.hook.ok) lines.push(...formatGlobalInstall(outcome.hook.result));
  else lines.push(`The hook is NOT installed: ${safeText(outcome.hook.message)}`, "Fix that, then run 'devguard install --global'. Pushes are not checked until it is installed.");
  lines.push(
    ...(outcome.sync.state === "failed"
      ? [`Projects were not synced yet: ${FAILURE_TEXT[outcome.sync.reason]} Run 'devguard sync' to try again.`]
      : formatSync(outcome.sync)),
  );
  return lines;
}

export function formatServerCheck(check: ServerCheck): string {
  switch (check.state) {
    case "reachable":
      return "Server check: reachable, and it accepted this device.";
    case "not_enrolled":
      return "Server check: skipped (this device is not enrolled).";
    case "unusable_state":
      return "Server check: skipped (local enrollment files are unusable; see above).";
    case "failed":
      return `Server check: ${FAILURE_TEXT[check.reason]}`;
  }
}
