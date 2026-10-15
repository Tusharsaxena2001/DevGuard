import { describe, expect, it } from "vitest";
import {
  AgentProjectSchema,
  DecisionSchema,
  ErrorCode,
  ExceptionRequestInputSchema,
  FindingSchema,
  OutgoingChangeSummarySchema,
  ProjectPolicySchema,
  RoleSchema,
  RuleIdSchema,
  SecurityEventBatchSchema,
  SecurityEventInputSchema,
  ValidExceptionSchema,
} from "./index.js";

const sha = "a".repeat(40);
const sha256 = "b".repeat(64);
const now = "2026-10-09T12:00:00.000Z";

const policy = {
  version: 1,
  mode: "enforce",
  classification: "client_owned",
  destinations: [{ host: "github.com", repoPath: "acme-corp/portal", type: "exact" }],
  prohibitedGlobs: [".env"],
  secretRules: ["aws_access_key_id"],
};

const event = {
  idempotencyKey: "idem-12345678",
  correlationId: "corr-12345678",
  occurredAt: now,
  projectId: "proj-1",
  destination: { host: "github.com", repoPath: "priya/portal" },
  operation: "push",
  refs: ["refs/heads/main"],
  outcome: "blocked",
  ruleIds: ["destination_not_approved"],
  findings: [],
  mode: "enforce",
  wouldBlock: false,
  policyVersion: 1,
  agentVersion: "0.0.0",
};

describe("enums", () => {
  it("exposes exactly the documented roles", () => {
    expect(RoleSchema.options).toEqual(["employee", "team_lead", "project_owner", "security_admin"]);
  });

  it("rejects unknown roles and rule ids", () => {
    expect(RoleSchema.safeParse("root").success).toBe(false);
    expect(RuleIdSchema.safeParse("made_up").success).toBe(false);
  });

  it("error codes are stable strings", () => {
    expect(ErrorCode.SelfApprovalForbidden).toBe("self_approval_forbidden");
    expect(ErrorCode.Forbidden).toBe("forbidden");
  });
});

describe("ProjectPolicy", () => {
  it("accepts a valid policy", () => {
    expect(ProjectPolicySchema.safeParse(policy).success).toBe(true);
  });

  it.each([
    ["version 0", { ...policy, version: 0 }],
    ["unknown mode", { ...policy, mode: "log_only" }],
    ["unknown classification", { ...policy, classification: "public" }],
    ["destination type", { ...policy, destinations: [{ host: "h", repoPath: "a/b", type: "regex" }] }],
    ["extra field", { ...policy, allowEverything: true }],
  ])("rejects %s", (_name, value) => {
    expect(ProjectPolicySchema.safeParse(value).success).toBe(false);
  });
});

describe("AgentProject", () => {
  const project = {
    projectId: "p1",
    name: "Acme Portal",
    policy,
    canonicalRepos: [{ host: "github.com", repoPath: "acme-corp/portal" }],
    fingerprints: [sha, sha256],
  };

  it("accepts SHA-1 and SHA-256 fingerprints", () => {
    expect(AgentProjectSchema.safeParse(project).success).toBe(true);
  });

  it.each(["short", "A".repeat(40), "g".repeat(40)])("rejects bad fingerprint %s", (fp) => {
    expect(AgentProjectSchema.safeParse({ ...project, fingerprints: [fp] }).success).toBe(false);
  });
});

describe("Finding (data minimisation)", () => {
  const finding = { ruleId: "aws_access_key_id", kind: "secret", path: "src/a.ts", commit: sha, line: 3 };

  it("accepts rule, kind, path, commit, line", () => {
    expect(FindingSchema.safeParse(finding).success).toBe(true);
  });

  it.each(["match", "content", "value", "snippet", "secret", "text"])(
    "rejects a %s field so values cannot be carried",
    (key) => {
      expect(FindingSchema.safeParse({ ...finding, [key]: "synthetic-value" }).success).toBe(false);
    },
  );

  it("rejects a non-positive line and an invalid commit", () => {
    expect(FindingSchema.safeParse({ ...finding, line: 0 }).success).toBe(false);
    expect(FindingSchema.safeParse({ ...finding, commit: "abc" }).success).toBe(false);
  });
});

describe("OutgoingChangeSummary", () => {
  const summary = {
    refs: [
      { localRef: "refs/heads/main", localSha: sha, remoteRef: "refs/heads/main", remoteSha: "0".repeat(40), kind: "create", forcePush: false },
    ],
    commitCount: 2,
    files: [{ path: ".env", commit: sha, change: "added" }],
  };

  it("accepts paths and change types", () => {
    expect(OutgoingChangeSummarySchema.safeParse(summary).success).toBe(true);
  });

  it("rejects file contents on a changed file", () => {
    const bad = { ...summary, files: [{ ...summary.files[0], content: "KEY=1" }] };
    expect(OutgoingChangeSummarySchema.safeParse(bad).success).toBe(false);
  });
});

describe("Decision", () => {
  const decision = {
    outcome: "blocked",
    ruleId: "destination_not_approved",
    reasons: ["Destination github.com/priya/portal is not approved for this project"],
    findings: [],
    wouldBlock: false,
    violatedRuleIds: ["destination_not_approved"],
  };

  it("accepts a valid decision", () => {
    expect(DecisionSchema.safeParse(decision).success).toBe(true);
  });

  it("rejects unknown outcome and extra fields", () => {
    expect(DecisionSchema.safeParse({ ...decision, outcome: "maybe" }).success).toBe(false);
    expect(DecisionSchema.safeParse({ ...decision, diff: "..." }).success).toBe(false);
  });
});

describe("SecurityEventInput", () => {
  it("accepts a minimal event", () => {
    expect(SecurityEventInputSchema.safeParse(event).success).toBe(true);
  });

  it("accepts an unparsable destination as null", () => {
    expect(SecurityEventInputSchema.safeParse({ ...event, destination: null }).success).toBe(true);
  });

  it.each(["userId", "deviceId", "fileContents", "diff", "remoteUrl", "token"])(
    "rejects client-supplied %s (identity comes from the credential; no content)",
    (key) => {
      expect(SecurityEventInputSchema.safeParse({ ...event, [key]: "x" }).success).toBe(false);
    },
  );

  it("rejects a malformed timestamp and a missing idempotency key", () => {
    expect(SecurityEventInputSchema.safeParse({ ...event, occurredAt: "yesterday" }).success).toBe(false);
    const rest: Record<string, unknown> = { ...event };
    delete rest["idempotencyKey"];
    expect(SecurityEventInputSchema.safeParse(rest).success).toBe(false);
  });

  it("limits batch size", () => {
    expect(SecurityEventBatchSchema.safeParse({ events: [] }).success).toBe(false);
    expect(SecurityEventBatchSchema.safeParse({ events: Array(101).fill(event) }).success).toBe(false);
    expect(SecurityEventBatchSchema.safeParse({ events: [event] }).success).toBe(true);
  });
});

describe("Exceptions", () => {
  it("requires a meaningful reason", () => {
    const base = { projectId: "p1", destination: "git@github.com:x/y.git" };
    expect(ExceptionRequestInputSchema.safeParse({ ...base, reason: "short" }).success).toBe(false);
    expect(ExceptionRequestInputSchema.safeParse({ ...base, reason: "Contractor handover needs this" }).success).toBe(true);
  });

  it("ValidException is scoped to a project and normalized destination", () => {
    const exc = {
      id: "e1",
      projectId: "p1",
      destination: { host: "github.com", repoPath: "contractor/portal" },
      status: "approved",
      expiresAt: now,
      approverId: "u2",
      requesterId: "u1",
      waivedRuleIds: [],
    };
    expect(ValidExceptionSchema.safeParse(exc).success).toBe(true);
    expect(ValidExceptionSchema.safeParse({ ...exc, projectId: undefined }).success).toBe(false);
    expect(ValidExceptionSchema.safeParse({ ...exc, status: "forever" }).success).toBe(false);
  });
});
