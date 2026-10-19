import { describe, expect, it } from "vitest";
import type { SecurityEventInput } from "@devguard/shared";
import { buildAlertMessage, type AlertContext } from "./alert-message.js";

const synthetic = ["gh", "p_", "Z".repeat(36)].join("");

const event = (over: Partial<SecurityEventInput> = {}): SecurityEventInput => ({
  idempotencyKey: "key-12345678",
  correlationId: "corr-12345678",
  occurredAt: "2026-06-01T12:00:00.000Z",
  projectId: null,
  destination: { host: "github.com", repoPath: "personal/fork" },
  operation: "push",
  refs: ["refs/heads/main"],
  outcome: "blocked",
  ruleIds: ["destination_not_approved"],
  findings: [{ ruleId: "github_token", kind: "secret", path: "src/secret-config.ts", line: 3, commit: "a".repeat(40) }],
  mode: "enforce",
  wouldBlock: true,
  policyVersion: 1,
  agentVersion: "0.1.0",
  ...over,
});

const context = (over: Partial<AlertContext> = {}): AlertContext => ({
  reason: "blocked_push",
  event: event(),
  projectName: "payments",
  userName: "alice",
  deviceName: "alice-laptop",
  dashboardEventsUrl: "http://localhost:5173/events",
  ...over,
});

describe("buildAlertMessage", () => {
  it("carries the metadata and a dashboard link to every recipient", () => {
    const m = buildAlertMessage(context(), ["a@example.test", "b@example.test"]);
    expect(m.to).toEqual(["a@example.test", "b@example.test"]);
    expect(m.subject).toBe("[DevGuard] A push was blocked: payments");
    for (const part of ["payments", "alice", "alice-laptop", "github.com/personal/fork", "enforce", "destination_not_approved", "http://localhost:5173/events"]) {
      expect(m.text).toContain(part);
    }
  });

  it("never includes findings: no file path, line, commit or matched text", () => {
    const m = buildAlertMessage(context({ event: event({ ruleIds: ["secret_detected"] }), reason: "high_severity" }), ["a@example.test"]);
    expect(m.text).not.toContain("secret-config");
    expect(m.text).not.toContain("github_token");
    expect(m.text).not.toContain("a".repeat(40));
    expect(m.text).not.toContain(synthetic);
  });

  it("states what the event does and does not prove", () => {
    expect(buildAlertMessage(context(), ["a@example.test"]).text).toContain("does not show whether data was or was not exfiltrated");
  });

  it("handles an unmatched repo and an unparsable destination", () => {
    const m = buildAlertMessage(context({ projectName: null, event: event({ destination: null }) }), ["a@example.test"]);
    expect(m.subject).toContain("unmatched repository");
    expect(m.text).toContain("unknown (could not be parsed)");
  });

  it("cuts long fields and removes line separators and bidi overrides", () => {
    const m = buildAlertMessage(context({ event: event({ destination: { host: "a".repeat(255), repoPath: "x\u2028y\u202ez" } }) }), ["a@example.test"]);
    const line = m.text.split("\n").find((l) => l.startsWith("Destination:")) ?? "";
    expect(line.length).toBeLessThan(140);
    expect(line).toContain("...");
    expect(m.text).not.toMatch(/[\u2028\u202e]/);
  });

  it("strips control characters so agent-supplied text cannot forge lines or headers", () => {
    const m = buildAlertMessage(
      context({ projectName: "pay\r\nBcc: evil@example.test", event: event({ destination: { host: "evil.test", repoPath: "x\nOutcome: allowed" } }) }),
      ["a@example.test"],
    );
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text.split("\n").filter((l) => l.startsWith("Outcome:"))).toHaveLength(1);
  });
});
