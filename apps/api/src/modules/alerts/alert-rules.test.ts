import { describe, expect, it } from "vitest";
import type { SecurityEventInput } from "@devguard/shared";
import { alertReason } from "./alert-rules.js";

type Case = Pick<SecurityEventInput, "outcome" | "mode" | "ruleIds">;

describe("alertReason", () => {
  it.each<[string, Case, ReturnType<typeof alertReason>]>([
    ["blocked in enforce mode", { outcome: "blocked", mode: "enforce", ruleIds: ["destination_not_approved"] }, "blocked_push"],
    ["blocked for a prohibited file", { outcome: "blocked", mode: "enforce", ruleIds: ["prohibited_file"] }, "blocked_push"],
    ["a block outranks the severity label", { outcome: "blocked", mode: "enforce", ruleIds: ["secret_detected"] }, "blocked_push"],
    ["secret found but not blocked (no mode)", { outcome: "allowed", mode: null, ruleIds: ["secret_detected"] }, "high_severity"],
    ["scan error", { outcome: "error", mode: "enforce", ruleIds: ["scan_error"] }, "high_severity"],
    ["scan error with no mode", { outcome: "error", mode: null, ruleIds: ["scan_error"] }, "high_severity"],
    ["a secret rule among others on an allowed outcome", { outcome: "allowed", mode: null, ruleIds: ["allowed", "secret_detected"] }, "high_severity"],
    ["audit-only never alerts, even with a secret", { outcome: "allowed", mode: "audit_only", ruleIds: ["secret_detected"] }, null],
    ["audit-only would-have-blocked", { outcome: "allowed", mode: "audit_only", ruleIds: ["destination_not_approved"] }, null],
    ["allowed push", { outcome: "allowed", mode: "enforce", ruleIds: ["allowed"] }, null],
    ["unprotected repo", { outcome: "allowed", mode: null, ruleIds: ["unprotected_repo"] }, null],
    ["exception granted", { outcome: "exception", mode: "enforce", ruleIds: ["exception_granted"] }, null],
    ["policy unavailable but allowed", { outcome: "allowed", mode: "audit_only", ruleIds: ["policy_unavailable"] }, null],
  ])("%s", (_name, event, expected) => {
    expect(alertReason(event)).toBe(expected);
  });
});
