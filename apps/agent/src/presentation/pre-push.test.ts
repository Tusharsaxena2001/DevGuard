import { describe, expect, it } from "vitest";
import type { Decision } from "@devguard/shared";
import { formatCannotCheck, formatDecision, safeText, type DecisionView } from "./pre-push.js";

const base: Decision = { outcome: "blocked", ruleId: "secret_detected", reasons: ["1 possible secret(s) found in outgoing commits."], findings: [{ ruleId: "github_token", kind: "secret", path: "a.ts", commit: "c".repeat(40), line: 4 }], wouldBlock: false, violatedRuleIds: ["secret_detected"] };
const view = (over: Partial<DecisionView> = {}, decision: Partial<Decision> = {}): DecisionView => ({
  decision: { ...base, ...decision },
  projectName: "Portal",
  classification: "confidential",
  mode: "enforce",
  destination: { host: "github.com", repoPath: "acme/portal" },
  forcePushRefs: [],
  correlationId: "ref-1",
  ...over,
});

describe("safeText", () => {
  it("replaces control characters and truncates long text", () => {
    expect(safeText("a\u001b[0m\nb\u0000c\u007fd\u009be")).toBe("a?[0m?b?c?d?e");
    expect(safeText("x".repeat(300))).toHaveLength(203);
  });
});

describe("formatDecision", () => {
  it("is silent for a clean allow", () => {
    expect(formatDecision(view({}, { outcome: "allowed", ruleId: "allowed", reasons: [], findings: [], violatedRuleIds: [] }))).toEqual([]);
  });

  it("explains a block with project, destination, reasons, details, next step and reference", () => {
    const text = formatDecision(view()).join("\n");
    expect(text).toContain("DevGuard blocked this push.");
    expect(text).toContain("Project: Portal (confidential, enforce)");
    expect(text).toContain("Destination: github.com/acme/portal");
    expect(text).toContain("secret: github_token  a.ts:4 (commit ccccccc)");
    expect(text).toContain("Next:");
    expect(text).toContain("Reference: ref-1");
  });

  it("describes audit-only as allowed-but-recorded and omits the 'next step'", () => {
    const text = formatDecision(view({ mode: "audit_only" }, { outcome: "allowed", wouldBlock: true })).join("\n");
    expect(text).toContain("audit-only");
    expect(text).toContain("allowed and recorded");
    expect(text).not.toContain("Next:");
  });

  it("says when the destination could not be parsed", () => {
    expect(formatDecision(view({ destination: null })).join("\n")).toContain("could not be parsed (treated as not approved)");
  });

  it("mentions force-pushes and caps the list of details", () => {
    const findings = Array.from({ length: 20 }, (_, i) => ({ ruleId: "prohibited_file", kind: "prohibited_file" as const, path: `f${i}`, commit: "c".repeat(40) }));
    const lines = formatDecision(view({ forcePushRefs: ["refs/heads/main"] }, { findings }));
    expect(lines.join("\n")).toContain("force-push (not a fast-forward) was detected for refs/heads/main");
    expect(lines.filter((l) => l.startsWith("    prohibited file")).length).toBe(15);
    expect(lines.join("\n")).toContain("...and 5 more");
  });

  it("reports an approved exception", () => {
    expect(formatDecision(view({}, { outcome: "exception", exceptionId: "ex-9", violatedRuleIds: ["destination_not_approved"] }))).toEqual(["DevGuard: allowed by approved exception ex-9."]);
  });

  it("an error outcome is shown as 'could not check', blocked in enforce and allowed in audit-only", () => {
    expect(formatDecision(view({}, { outcome: "error" })).join("\n")).toContain("blocked this push because it could not check it");
    expect(formatDecision(view({ mode: "audit_only" }, { outcome: "error" })).join("\n")).toContain("allowed and recorded");
  });
});

describe("formatCannotCheck", () => {
  it("includes the reason, a pointer to 'devguard status' and the reference", () => {
    const text = formatCannotCheck("State unreadable.", "blocked", "ref-2").join("\n");
    expect(text).toContain("Reason: State unreadable.");
    expect(text).toContain("devguard status");
    expect(text).toContain("Reference: ref-2");
  });
});
