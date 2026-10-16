/** Local, readable time for a UTC ISO string. Unparsable input is shown as is (never throws). */
export function formatTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const destinationLabel = (d: { host: string; repoPath: string } | null): string => (d === null ? "unparsable" : `${d.host}/${d.repoPath}`);

/** A message for a failed call that tells the person what to do, not how it failed internally. */
export function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    const code = String((error as { code: unknown }).code);
    const message = String((error as { message: unknown }).message);
    if (code === "unreachable") return "Could not reach the DevGuard server. Check that the API is running.";
    if (code === "forbidden") return "You do not have permission to do that.";
    if (code === "self_approval_forbidden") return "You cannot decide your own request. Ask another administrator.";
    // Field reasons are stable codes (never the submitted value), so they are safe to show.
    const issues = (error as { issues?: unknown }).issues;
    const reasons = Array.isArray(issues) ? issues.flatMap((i: unknown) => (typeof i === "object" && i !== null && "code" in i ? [String((i as { code: unknown }).code)] : [])) : [];
    return reasons.length > 0 ? `${message} Reason: ${[...new Set(reasons)].join(", ")}.` : message;
  }
  return "Something went wrong. Try again.";
}
