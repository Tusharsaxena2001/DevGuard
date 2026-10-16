import { safeText } from "../safe-text.js";
import type { ServerCheck } from "../use-cases/check-server.js";
import type { RepoProtection } from "../use-cases/get-repo-protection.js";
import type { FileState, StatusReport } from "../use-cases/get-status.js";

const STATE_TEXT: Record<FileState, string> = {
  ok: "ok",
  missing: "not set up",
  invalid: "INVALID (malformed or inconsistent; fix or delete it, or enroll again)",
  insecure_permissions: "REFUSED (wrong owner or open to other users; use chmod 600 on files, chmod 700 on the directory)",
  unreadable: "UNREADABLE",
};

const FRESHNESS_NOTE: Record<string, string> = {
  stale_ok: " (not refreshed recently; still trusted until the limit)",
  expired: " (EXPIRED: pushes to enforced projects are blocked until 'devguard sync' succeeds)",
};
const freshnessNote = (freshness: string | undefined): string => (freshness === undefined ? "" : (FRESHNESS_NOTE[freshness] ?? ""));

export function formatStatusText(report: StatusReport): string[] {
  const lines = [
    `DevGuard state: ${report.location}`,
    report.enrolled ? "Device: enrolled" : "Device: not enrolled",
    ...(report.serverUrl ? [`Server: ${safeText(report.serverUrl)}`] : []),
    ...(report.deviceId ? [`Device id: ${safeText(report.deviceId)}`] : []),
    ...(report.lastContactAt ? [`Last server contact: ${safeText(report.lastContactAt)}`] : []),
    `Config: ${STATE_TEXT[report.config]}`,
    `Credentials: ${STATE_TEXT[report.credentials]}`,
    ...(report.events === undefined ? [] : [`Pending events: ${report.events.pending}${report.events.dropped > 0 ? ` (${report.events.dropped} lost because the queue was full or damaged)` : ""}`]),
    `Registered repos: ${report.repos === "ok" ? report.registeredRepoCount : STATE_TEXT[report.repos]}`,
    report.policyCache !== "ok"
      ? `Cached policies: ${STATE_TEXT[report.policyCache]}`
      : report.policies.length === 0
        ? "Cached policies: none"
        : "Cached policies:",
    ...report.policies.map((p) => `  ${safeText(p.projectId)}: ${p.state === "ok" ? `${p.source === "server" ? "from the server" : "supplied locally"}, fetched ${safeText(p.fetchedAt ?? "unknown")}${freshnessNote(p.freshness)}` : STATE_TEXT[p.state]}`),
  ];
  return report.healthy ? lines : [...lines, "Problem found: see the entries marked above."];
}

const VIA_TEXT = { fingerprint: "its first commit", remote: "its remote", manual: "manual registration" } as const;

/** One line about the repository the command ran in; nothing for a directory that is not a repository. */
export function formatRepoProtection(repo: RepoProtection): string[] {
  switch (repo.state) {
    case "not_a_repo":
      return [];
    case "unprotected":
      return ["This repository: not protected (it matches no project)."];
    case "cannot_tell":
      return [
        `This repository: PROTECTION UNKNOWN (${repo.reason === "state_unusable" ? "DevGuard's local state is unreadable" : "a project policy is unusable"}); pushes are blocked until fixed.`,
      ];
    case "protected":
      return [
        `This repository: protected by ${safeText(repo.projectName)} (${repo.mode === "enforce" ? "enforce" : "audit-only"}), recognised by ${VIA_TEXT[repo.via]}${repo.otherMatches > 0 ? `; also matches ${repo.otherMatches} other project(s), the strictest applies` : ""}.`,
      ];
  }
}

export function formatStatusJson(report: StatusReport, serverCheck?: ServerCheck): string {
  return JSON.stringify(serverCheck ? { ...report, serverCheck } : report, null, 2);
}
