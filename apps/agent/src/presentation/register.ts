import type { RegisterResult, UnregisterResult } from "../use-cases/register-repo.js";
import { safeText } from "../safe-text.js";

export function formatRegister(result: RegisterResult): string[] {
  const lines = [
    result.alreadyRegistered
      ? `${safeText(result.repoPath)} was already registered to project ${safeText(result.projectName)}.`
      : `Registered ${safeText(result.repoPath)} to project ${safeText(result.projectName)} (${safeText(result.projectId)}).`,
  ];
  if (result.policyCached) {
    lines.push("The project policy was read from the file you gave and saved on this device. It is not verified by a server.");
  }
  lines.push("Pushes from this repository are now checked by DevGuard (once the hook is installed: 'devguard install --global').");
  return lines;
}

export function formatUnregister(result: UnregisterResult): string[] {
  return result.removed === 0
    ? [`${safeText(result.repoPath)} had no manual registration. Repositories recognised automatically stay protected.`]
    : [
        `Removed the manual registration of ${safeText(result.repoPath)}.`,
        "If a project still recognises it by remote or first commit, it stays protected.",
      ];
}
