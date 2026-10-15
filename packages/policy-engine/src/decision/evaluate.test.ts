import { describe, expect, it } from "vitest";
import { DecisionSchema, type Finding, type ProjectPolicy, type ValidException } from "@devguard/shared";
import { evaluatePush, type PushEvaluationInput } from "./evaluate.js";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const COMMIT = "c".repeat(40);
const APPROVED_URL = "https://github.com/acme/portal.git";
const OTHER_URL = "https://github.com/personal/fork";

const policy = (over: Partial<ProjectPolicy> = {}): ProjectPolicy => ({
  version: 1,
  mode: "enforce",
  classification: "confidential",
  destinations: [{ id: "d1", host: "github.com", repoPath: "acme/portal", type: "exact" }],
  prohibitedGlobs: [".env"],
  secretRules: ["github_token"],
  ...over,
});

const finding = (kind: Finding["kind"], ruleId = kind as string): Finding => ({ ruleId, kind, path: "a/b.ts", commit: COMMIT });
const exception = (over: Partial<ValidException> = {}): ValidException => ({
  id: "ex1",
  projectId: "p1",
  destination: { host: "github.com", repoPath: "personal/fork" },
  status: "approved",
  expiresAt: "2026-06-02T12:00:00.000Z",
  approverId: "lead",
  requesterId: "dev",
  waivedRuleIds: [],
  ...over,
});

const input = (over: Partial<PushEvaluationInput> = {}): PushEvaluationInput => ({
  projectId: "p1",
  protected: true,
  policy: policy(),
  destinationRaw: APPROVED_URL,
  content: [],
  exceptions: [],
  now: NOW,
  ...over,
});

const evaluate = (over: Partial<PushEvaluationInput> = {}) => evaluatePush(input(over));

describe("evaluatePush: protection and the clean path", () => {
  it("allows an unprotected repo regardless of destination or content", () => {
    const d = evaluate({ protected: false, destinationRaw: "garbage", content: [finding("secret")] });
    expect(d).toMatchObject({ outcome: "allowed", ruleId: "unprotected_repo", wouldBlock: false, violatedRuleIds: [] });
  });

  it("does not look at the policy of an unprotected repo", () => {
    expect(evaluate({ protected: false, policy: {} as ProjectPolicy }).outcome).toBe("allowed");
  });

  it("allows an approved destination with no findings", () => {
    expect(evaluate()).toMatchObject({ outcome: "allowed", ruleId: "allowed", wouldBlock: false, violatedRuleIds: [] });
  });

  it("matches the destination across URL forms", () => {
    expect(evaluate({ destinationRaw: "git@github.com:acme/portal.git" }).outcome).toBe("allowed");
  });
});

describe("evaluatePush: mode x violation matrix", () => {
  const violations: [name: string, over: Partial<PushEvaluationInput>, ruleId: string][] = [
    ["unapproved destination", { destinationRaw: OTHER_URL }, "destination_not_approved"],
    ["unparsable destination", { destinationRaw: "not a url" }, "destination_not_approved"],
    ["lookalike destination", { destinationRaw: "https://github.com.evil.io/acme/portal" }, "destination_not_approved"],
    ["prohibited file", { content: [finding("prohibited_file")] }, "prohibited_file"],
    ["secret", { content: [finding("secret", "github_token")] }, "secret_detected"],
    ["scan error", { content: [finding("scan_error")] }, "scan_error"],
  ];

  it.each(violations)("enforce blocks: %s", (_n, over, ruleId) => {
    const d = evaluate(over);
    expect(d).toMatchObject({ outcome: "blocked", ruleId, wouldBlock: false });
    expect(d.violatedRuleIds).toEqual([ruleId]);
  });

  it.each(violations)("audit-only allows but flags wouldBlock: %s", (_n, over, ruleId) => {
    const d = evaluate({ ...over, policy: policy({ mode: "audit_only" }) });
    expect(d).toMatchObject({ outcome: "allowed", ruleId, wouldBlock: true });
    expect(d.violatedRuleIds).toEqual([ruleId]);
    expect(d.reasons.at(-1)).toMatch(/audit-only/i);
  });
});

describe("evaluatePush: multiple violations", () => {
  const all = (): Partial<PushEvaluationInput> => ({
    destinationRaw: OTHER_URL,
    content: [finding("scan_error"), finding("prohibited_file"), finding("secret", "github_token"), finding("secret", "slack_token")],
  });

  it("reports every violation in a fixed priority order, primary first", () => {
    const d = evaluate(all());
    expect(d.violatedRuleIds).toEqual(["destination_not_approved", "secret_detected", "prohibited_file", "scan_error"]);
    expect(d.ruleId).toBe("destination_not_approved");
    expect(d.reasons).toHaveLength(4);
    expect(d.reasons[1]).toContain("2 possible secret(s)");
  });

  it("is independent of the order of input findings", () => {
    const base = all();
    const reversed = { ...base, content: [...(base.content ?? [])].reverse() };
    expect(evaluate(reversed).violatedRuleIds).toEqual(evaluate(base).violatedRuleIds);
    expect(evaluate(reversed).ruleId).toBe(evaluate(base).ruleId);
  });

  it("without a destination problem the primary rule is the most serious content rule", () => {
    expect(evaluate({ content: [finding("prohibited_file"), finding("secret")] }).ruleId).toBe("secret_detected");
  });

  it("returns all findings as evidence", () => {
    expect(evaluate(all()).findings).toHaveLength(4);
  });
});

describe("evaluatePush: exceptions", () => {
  it("turns an unapproved-destination block into an exception outcome", () => {
    const d = evaluate({ destinationRaw: OTHER_URL, exceptions: [exception()] });
    expect(d).toMatchObject({
      outcome: "exception",
      ruleId: "exception_granted",
      exceptionId: "ex1",
      wouldBlock: false,
      violatedRuleIds: ["destination_not_approved"],
    });
  });

  it("works across URL forms of the same destination", () => {
    expect(evaluate({ destinationRaw: "git@github.com:personal/fork.git", exceptions: [exception()] }).outcome).toBe("exception");
  });

  it.each([
    ["expired", { expiresAt: NOW.toISOString() }],
    ["pending", { status: "pending" as const }],
    ["revoked", { status: "revoked" as const }],
    ["rejected", { status: "rejected" as const }],
    ["other project", { projectId: "p2" }],
    ["other destination", { destination: { host: "github.com", repoPath: "personal/other" } }],
    ["self-approved", { approverId: "dev" }],
  ])("ignores a %s exception", (_n, over) => {
    const base = { destinationRaw: OTHER_URL, exceptions: [exception(over)] };
    const enforced = evaluate(base);
    expect(enforced).toMatchObject({ outcome: "blocked", ruleId: "destination_not_approved", violatedRuleIds: ["destination_not_approved"] });
    expect(enforced.exceptionId).toBeUndefined();
    const audited = evaluate({ ...base, policy: policy({ mode: "audit_only" }) });
    expect(audited).toMatchObject({ outcome: "allowed", ruleId: "destination_not_approved", wouldBlock: true });
    expect(audited.exceptionId).toBeUndefined();
  });

  it("never lets an exception rescue an unparsable destination", () => {
    const d = evaluate({ destinationRaw: "not a url", exceptions: [exception()] });
    expect(d.outcome).toBe("blocked");
  });

  it("does not waive content findings by default (ADR-007)", () => {
    const d = evaluate({ destinationRaw: OTHER_URL, exceptions: [exception()], content: [finding("secret")] });
    expect(d).toMatchObject({ outcome: "blocked", ruleId: "secret_detected", violatedRuleIds: ["secret_detected"] });
  });

  it("waives a content rule only when the exception lists it", () => {
    const d = evaluate({
      destinationRaw: OTHER_URL,
      exceptions: [exception({ waivedRuleIds: ["secret_detected"] })],
      content: [finding("secret"), finding("prohibited_file")],
    });
    expect(d).toMatchObject({ outcome: "blocked", ruleId: "prohibited_file", violatedRuleIds: ["prohibited_file"] });
    const both = evaluate({
      destinationRaw: OTHER_URL,
      exceptions: [exception({ waivedRuleIds: ["secret_detected", "prohibited_file"] })],
      content: [finding("secret"), finding("prohibited_file")],
    });
    expect(both).toMatchObject({ outcome: "exception", violatedRuleIds: ["destination_not_approved", "secret_detected", "prohibited_file"] });
  });

  it("never waives scan errors or internal errors, even if listed", () => {
    const d = evaluate({
      destinationRaw: OTHER_URL,
      exceptions: [exception({ waivedRuleIds: ["scan_error", "internal_error", "unknown_rule"] })],
      content: [finding("scan_error")],
    });
    expect(d).toMatchObject({ outcome: "blocked", ruleId: "scan_error" });
  });

  it("a listed waiver also covers an already-approved destination", () => {
    const d = evaluate({
      exceptions: [exception({ destination: { host: "github.com", repoPath: "acme/portal" }, waivedRuleIds: ["prohibited_file"] })],
      content: [finding("prohibited_file")],
    });
    expect(d).toMatchObject({ outcome: "exception", exceptionId: "ex1" });
  });

  it("an exception with nothing to waive does not change an allowed push", () => {
    const d = evaluate({ exceptions: [exception({ destination: { host: "github.com", repoPath: "acme/portal" } })] });
    expect(d).toMatchObject({ outcome: "allowed", ruleId: "allowed" });
    expect(d.exceptionId).toBeUndefined();
  });

  it("audit-only with a fully waived push is an exception, not wouldBlock", () => {
    const d = evaluate({ destinationRaw: OTHER_URL, exceptions: [exception()], policy: policy({ mode: "audit_only" }) });
    expect(d).toMatchObject({ outcome: "exception", wouldBlock: false });
  });

  it("audit-only with leftover content violations allows with wouldBlock", () => {
    const d = evaluate({
      destinationRaw: OTHER_URL,
      exceptions: [exception()],
      content: [finding("secret")],
      policy: policy({ mode: "audit_only" }),
    });
    expect(d).toMatchObject({ outcome: "allowed", ruleId: "secret_detected", wouldBlock: true });
  });

  it("picks the longest-lived valid exception, ties by lowest id, regardless of input order", () => {
    const list = [
      exception({ id: "b", expiresAt: "2026-06-03T00:00:00.000Z" }),
      exception({ id: "z", expiresAt: "2026-06-04T00:00:00.000Z" }),
      exception({ id: "a", expiresAt: "2026-06-04T00:00:00.000Z" }),
      exception({ id: "x", expiresAt: "2026-05-01T00:00:00.000Z" }),
    ];
    expect(evaluate({ destinationRaw: OTHER_URL, exceptions: list }).exceptionId).toBe("a");
    expect(evaluate({ destinationRaw: OTHER_URL, exceptions: [...list].reverse() }).exceptionId).toBe("a");
  });

  it("expiry boundary: blocked at now === expiresAt, exception one millisecond before", () => {
    const at = (expiresAt: string) => evaluate({ destinationRaw: OTHER_URL, exceptions: [exception({ expiresAt })] }).outcome;
    expect(at("2026-06-01T12:00:00.001Z")).toBe("exception");
    expect(at("2026-06-01T12:00:00.000Z")).toBe("blocked");
  });
});

describe("evaluatePush: fail-safe", () => {
  it.each([
    ["missing policy fields", { policy: { version: 1 } as unknown as ProjectPolicy }],
    ["unknown mode", { policy: { ...policy(), mode: "yolo" } as unknown as ProjectPolicy }],
    ["invalid now", { now: new Date("nope") }],
  ])("returns an error outcome for %s", (_n, over) => {
    expect(evaluate(over)).toMatchObject({
      outcome: "error",
      ruleId: "internal_error",
      wouldBlock: true,
      violatedRuleIds: ["internal_error"],
    });
  });

  it("returns an error outcome instead of throwing when inputs are garbage", () => {
    const bad = { ...input(), exceptions: null, content: undefined } as unknown as PushEvaluationInput;
    expect(() => evaluatePush(bad)).not.toThrow();
    expect(evaluatePush(bad).outcome).toBe("error");
  });

  it("treats an unrecognised finding kind as an error, not a pass", () => {
    const weird = { ruleId: "x", kind: "weird", path: "a" } as unknown as Finding;
    expect(evaluate({ content: [weird] })).toMatchObject({ outcome: "error", wouldBlock: true });
  });

  it("rejects findings carrying extra fields (e.g. a smuggled secret value)", () => {
    const smuggled = { ...finding("secret"), value: "should-never-appear" } as unknown as Finding;
    const d = evaluate({ content: [smuggled] });
    expect(d.outcome).toBe("error");
    expect(JSON.stringify(d)).not.toContain("should-never-appear");
  });

  it("ignores a malformed exception without discarding a valid one", () => {
    const bad = { id: "bad", status: "approved" } as unknown as ValidException;
    const d = evaluate({ destinationRaw: OTHER_URL, exceptions: [bad, null as never, exception()] });
    expect(d).toMatchObject({ outcome: "exception", exceptionId: "ex1" });
  });

  it("an exception with a zone-less expiry is not honoured", () => {
    expect(evaluate({ destinationRaw: OTHER_URL, exceptions: [exception({ expiresAt: "2999-01-01T00:00:00" })] }).outcome).toBe("blocked");
  });

  it("a self-approved exception still yields blocked", () => {
    expect(evaluate({ destinationRaw: OTHER_URL, exceptions: [exception({ approverId: "dev" })] }).outcome).toBe("blocked");
  });

  it("is not tricked by a policy that approves nothing", () => {
    expect(evaluate({ policy: policy({ destinations: [] }) }).outcome).toBe("blocked");
  });
});

describe("evaluatePush: data handling and purity", () => {
  it("never echoes the raw destination (it may carry credentials) or finding paths into reasons", () => {
    const url = "https://user:pw-" + "x".repeat(8) + "@github.com/personal/fork";
    const f = { ...finding("secret"), path: "very/secret/path-" + "p".repeat(20) + ".ts" };
    const d = evaluate({ destinationRaw: url, content: [f] });
    const text = JSON.stringify(d.reasons);
    expect(text).not.toContain("pw-");
    expect(text).not.toContain("secret/path");
  });

  it("produces decisions that satisfy the shared contract", () => {
    const cases: Partial<PushEvaluationInput>[] = [
      {},
      { protected: false },
      { destinationRaw: OTHER_URL },
      { destinationRaw: OTHER_URL, exceptions: [exception()] },
      { content: [finding("secret")], policy: policy({ mode: "audit_only" }) },
      { now: new Date("nope") },
    ];
    for (const over of cases) expect(DecisionSchema.safeParse(evaluate(over)).success).toBe(true);
  });

  it("caps findings and says so", () => {
    const many = Array.from({ length: 10_001 }, () => finding("secret"));
    const d = evaluate({ content: many });
    expect(d.findings).toHaveLength(10_000);
    expect(d.reasons.join(" ")).toMatch(/truncated/);
    expect(DecisionSchema.safeParse(d).success).toBe(true);
  });

  it("does not mutate its input and is deterministic", () => {
    const frozen = (o: unknown): void => {
      if (o && typeof o === "object") {
        Object.freeze(o);
        for (const v of Object.values(o)) frozen(v);
      }
    };
    const i = input({
      destinationRaw: OTHER_URL,
      content: [finding("secret"), finding("prohibited_file")],
      exceptions: [exception({ waivedRuleIds: ["secret_detected"] })],
    });
    frozen(i);
    const before = JSON.stringify(i);
    const a = evaluatePush(i);
    expect(JSON.stringify(i)).toBe(before);
    expect(evaluatePush(i)).toEqual(a);
  });
});

describe("evaluatePush: further regression cases", () => {
  it("scan errors stay unwaived next to a valid exception, in both modes", () => {
    for (const mode of ["enforce", "audit_only"] as const) {
      const d = evaluate({
        destinationRaw: OTHER_URL,
        exceptions: [exception({ waivedRuleIds: ["scan_error"] })],
        content: [finding("scan_error")],
        policy: policy({ mode }),
      });
      expect(d).toMatchObject({ ruleId: "scan_error", violatedRuleIds: ["scan_error"], wouldBlock: mode === "audit_only" });
    }
  });

  it.each(["unknown_rule", "internal_error"])("a listed %s waiver is harmless and waives nothing else", (id) => {
    const d = evaluate({ destinationRaw: OTHER_URL, exceptions: [exception({ waivedRuleIds: [id] })], content: [finding("secret")] });
    expect(d).toMatchObject({ outcome: "blocked", violatedRuleIds: ["secret_detected"] });
  });

  it("protected=false is allowed in audit-only mode and with an invalid `now`", () => {
    expect(evaluate({ protected: false, policy: policy({ mode: "audit_only" }) }).ruleId).toBe("unprotected_repo");
    expect(evaluate({ protected: false, now: new Date("nope") }).ruleId).toBe("unprotected_repo");
  });

  it("an invalid `now` is an error even with a valid audit-only policy", () => {
    expect(evaluate({ now: new Date("nope"), policy: policy({ mode: "audit_only" }) })).toMatchObject({ outcome: "error", wouldBlock: true, findings: [] });
  });

  it("content undefined and exceptions null each fail safe on their own", () => {
    expect(evaluate({ content: undefined as never }).outcome).toBe("error");
    expect(evaluate({ exceptions: null as never }).outcome).toBe("error");
  });

  it("a listed waiver with nothing to waive leaves an allowed push allowed", () => {
    const e = exception({ destination: { host: "github.com", repoPath: "acme/portal" }, waivedRuleIds: ["secret_detected"] });
    const d = evaluate({ exceptions: [e] });
    expect(d).toMatchObject({ outcome: "allowed", ruleId: "allowed" });
    expect(d.exceptionId).toBeUndefined();
  });

  it("does not union waivers: only the single selected exception applies (pinned behaviour)", () => {
    const longest = exception({ id: "a", expiresAt: "2026-06-05T00:00:00.000Z" });
    const waiver = exception({ id: "b", expiresAt: "2026-06-03T00:00:00.000Z", waivedRuleIds: ["secret_detected"] });
    const d = evaluate({ destinationRaw: OTHER_URL, exceptions: [longest, waiver], content: [finding("secret")] });
    expect(d).toMatchObject({ outcome: "blocked", ruleId: "secret_detected" });
  });

  it("keeps findings as evidence on an exception outcome", () => {
    const d = evaluate({ destinationRaw: OTHER_URL, exceptions: [exception({ waivedRuleIds: ["secret_detected"] })], content: [finding("secret")] });
    expect(d.outcome).toBe("exception");
    expect(d.findings).toHaveLength(1);
  });

  it.each([
    ["userinfo trick", "https://github.com@evil.example/personal/fork"],
    ["unexpected port", "https://github.com:8443/personal/fork"],
    ["ssh on a non-default port", "ssh://git@github.com:2222/personal/fork"],
    ["file scheme", "file:///personal/fork"],
    ["ext transport", "ext::sh -c id"],
    ["empty", ""],
    ["very long", "https://github.com/" + "a/".repeat(2000)],
  ])("destination trick (%s) is unapproved and not rescued by an exception for the clean destination", (_n, url) => {
    expect(evaluate({ destinationRaw: url, exceptions: [exception()] }).outcome).toBe("blocked");
  });

  it("truncation boundary: 10,000 findings is not truncated, 10,001 is; reason counts use the full total", () => {
    const at = (n: number) => evaluate({ content: Array.from({ length: n }, () => finding("secret")) });
    expect(at(10_000).reasons.join(" ")).not.toMatch(/truncated/);
    const over = at(10_001);
    expect(over.reasons.join(" ")).toMatch(/truncated/);
    expect(over.reasons[0]).toContain("10001 possible secret(s)");
  });

  it("explains each content rule with its count", () => {
    const d = evaluate({ content: [finding("prohibited_file"), finding("prohibited_file"), finding("scan_error")] });
    expect(d.reasons).toEqual([
      "2 prohibited file(s) found in outgoing commits.",
      "1 content scan error(s): outgoing commits could not be fully checked.",
    ]);
  });

  it("the whole decision omits the raw destination, userinfo and credentials", () => {
    const url = "https://user:pw-" + "x".repeat(8) + "@github.com/personal/fork";
    const d = evaluate({ destinationRaw: url, exceptions: [exception()] });
    const text = JSON.stringify(d);
    for (const needle of ["pw-", "user:", url, "github.com/personal"]) expect(text).not.toContain(needle);
  });

  it("does not depend on the wall clock, only on the injected `now`", () => {
    const base = { destinationRaw: OTHER_URL, exceptions: [exception()] };
    const expected = evaluate(base);
    const real = Date.now;
    try {
      Date.now = () => new Date("2099-01-01T00:00:00Z").getTime();
      expect(evaluate(base)).toEqual(expected);
    } finally {
      Date.now = real;
    }
  });

  it("is independent of any rotation of the input findings", () => {
    const content = [finding("scan_error"), finding("prohibited_file"), finding("secret"), finding("secret", "slack_token")];
    const results = content.map((_, i) => evaluate({ destinationRaw: OTHER_URL, content: [...content.slice(i), ...content.slice(0, i)] }));
    for (const r of results) {
      expect(r.violatedRuleIds).toEqual(results[0]?.violatedRuleIds);
      expect(r.ruleId).toBe(results[0]?.ruleId);
      expect(r.reasons).toEqual(results[0]?.reasons);
    }
  });

  it("conforms to the Decision contract for exception, scan-error and truncated audit-only cases", () => {
    const cases: Partial<PushEvaluationInput>[] = [
      { destinationRaw: OTHER_URL, exceptions: [exception()], policy: policy({ mode: "audit_only" }) },
      { content: [finding("scan_error")] },
      { content: Array.from({ length: 10_001 }, () => finding("secret")), policy: policy({ mode: "audit_only" }) },
    ];
    for (const over of cases) expect(DecisionSchema.safeParse(evaluate(over)).success).toBe(true);
  });
});
