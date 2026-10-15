import {
  FindingSchema,
  ProjectPolicySchema,
  RuleIdSchema,
  ValidExceptionSchema,
  type Decision,
  type Finding,
  type NormalizedDestination,
  type ProjectPolicy,
  type RuleId,
  type ValidException,
} from "@devguard/shared";
import { isApproved, normalizeDestination } from "../destination/index.js";
import { validateException } from "./exception.js";

export interface PushEvaluationInput {
  readonly projectId: string;
  /** Did the repo resolve to a project (ADR-003/008)? Unprotected repos are allowed. */
  readonly protected: boolean;
  readonly policy: ProjectPolicy;
  /** The remote URL Git is pushing to. Parsed here; never echoed back. */
  readonly destinationRaw: string;
  /** Findings from the content rules (SH-3), computed by the caller from the outgoing change. */
  readonly content: readonly Finding[];
  readonly exceptions: readonly ValidException[];
  readonly now: Date;
}

/** Violation priority: the first present is the primary rule. All present violations are always reported. */
const VIOLATION_ORDER: readonly RuleId[] = ["destination_not_approved", "secret_detected", "prohibited_file", "scan_error"];

/** Rules an exception may waive when it lists them (ADR-007). Scan errors and policy errors are never waivable. */
const WAIVABLE: ReadonlySet<RuleId> = new Set<RuleId>(["prohibited_file", "secret_detected"]);

const MAX_FINDINGS = 10_000;

function errorDecision(reason: string): Decision {
  return {
    outcome: "error",
    ruleId: "internal_error",
    reasons: [reason],
    findings: [],
    wouldBlock: true,
    violatedRuleIds: ["internal_error"],
  };
}

function violationFor(finding: Finding): RuleId {
  switch (finding.kind) {
    case "prohibited_file":
      return "prohibited_file";
    case "secret":
      return "secret_detected";
    case "scan_error":
      return "scan_error";
  }
}

/** The valid exception for this scope that lasts longest (ties: lowest id), so the choice is deterministic. */
function pickException(
  exceptions: readonly ValidException[],
  projectId: string,
  destination: NormalizedDestination,
  now: Date,
): ValidException | undefined {
  const valid = exceptions
    .filter((e) => validateException(e, { projectId, destination, now }).ok)
    .sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return valid[0];
}

function explain(rule: RuleId, count: number): string {
  switch (rule) {
    case "destination_not_approved":
      return "The push destination is not approved for this project.";
    case "secret_detected":
      return `${count} possible secret(s) found in outgoing commits.`;
    case "prohibited_file":
      return `${count} prohibited file(s) found in outgoing commits.`;
    default:
      return `${count} content scan error(s): outgoing commits could not be fully checked.`;
  }
}

function evaluate(input: PushEvaluationInput): Decision {
  if (!input.protected) {
    return {
      outcome: "allowed",
      ruleId: "unprotected_repo",
      reasons: ["Repository is not assigned to a protected project."],
      findings: [],
      wouldBlock: false,
      violatedRuleIds: [],
    };
  }

  const policy = ProjectPolicySchema.safeParse(input.policy);
  if (!policy.success) return errorDecision("Project policy is invalid.");
  if (Number.isNaN(input.now.getTime())) return errorDecision("Evaluation time is invalid.");
  // Findings are re-validated (strict: no extra fields, so nothing unexpected is echoed into the decision) and an
  // unrecognised kind is an error, never a silent pass. A malformed exception is treated as absent.
  const content = FindingSchema.array().safeParse(input.content);
  if (!content.success) return errorDecision("Content findings are invalid.");
  const exceptions = input.exceptions.flatMap((e) => {
    const parsed = ValidExceptionSchema.safeParse(e);
    return parsed.success ? [parsed.data] : [];
  });

  const counts = new Map<RuleId, number>();
  const bump = (rule: RuleId): void => void counts.set(rule, (counts.get(rule) ?? 0) + 1);

  const destination = normalizeDestination(input.destinationRaw);
  if (!destination.ok || !isApproved(destination.value, policy.data.destinations).approved) bump("destination_not_approved");
  for (const finding of content.data) bump(violationFor(finding));

  // An exception only ever applies to a destination that parsed: an unparsable one cannot match its scope.
  const exception = destination.ok
    ? pickException(exceptions, input.projectId, destination.value, input.now)
    : undefined;
  const waived = new Set<RuleId>();
  if (exception) {
    waived.add("destination_not_approved");
    for (const id of exception.waivedRuleIds) {
      const rule = RuleIdSchema.safeParse(id);
      if (rule.success && WAIVABLE.has(rule.data)) waived.add(rule.data);
    }
  }

  const violated = VIOLATION_ORDER.filter((rule) => counts.has(rule));
  const remaining = violated.filter((rule) => !waived.has(rule));
  const waivedHere = violated.filter((rule) => waived.has(rule));
  const findings = content.data.slice(0, MAX_FINDINGS);
  const reasons = remaining.map((rule) => explain(rule, counts.get(rule) ?? 0));
  if (content.data.length > MAX_FINDINGS) reasons.push("Findings were truncated to the reporting limit.");

  const first = remaining[0];
  if (first) {
    const enforce = policy.data.mode === "enforce";
    return {
      outcome: enforce ? "blocked" : "allowed",
      ruleId: first,
      reasons: enforce ? reasons : [...reasons, "Audit-only mode: this push would be blocked in enforce mode."],
      findings,
      wouldBlock: !enforce,
      violatedRuleIds: remaining,
    };
  }

  if (exception && waivedHere.length > 0) {
    return {
      outcome: "exception",
      ruleId: "exception_granted",
      reasons: ["An approved, unexpired exception covers this push."],
      findings,
      wouldBlock: false,
      violatedRuleIds: waivedHere,
      exceptionId: exception.id,
    };
  }

  return { outcome: "allowed", ruleId: "allowed", reasons: ["No policy violations found."], findings, wouldBlock: false, violatedRuleIds: [] };
}

/**
 * Combine destination, content findings, mode and exceptions into one deterministic `Decision`.
 *
 * Fail-safe: any thrown error or invalid state becomes an `error` outcome with `wouldBlock: true`, which callers
 * must treat as a block in enforce mode. Never throws, never mutates its input, never echoes the raw destination.
 */
export function evaluatePush(input: PushEvaluationInput): Decision {
  try {
    return evaluate(input);
  } catch {
    return errorDecision("Policy evaluation failed.");
  }
}
