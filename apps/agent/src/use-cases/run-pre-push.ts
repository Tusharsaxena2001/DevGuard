import type { AgentProject, Decision, EnforcementMode, OperationType, RefUpdate, RuleId, SecurityEventInput, ValidException } from "@devguard/shared";
import { evaluatePush, normalizeDestination } from "@devguard/policy-engine";
import type { Clock } from "../ports/clock.js";
import type { ConfigStore } from "../ports/config-store.js";
import type { EventSink } from "../ports/event-sink.js";
import type { GitPort } from "../ports/git.js";
import { formatCannotCheck, formatDecision, formatPolicyExpired } from "../presentation/pre-push.js";
import type { ExceptionCheck } from "./check-exception.js";
import { classifyFreshness } from "./policy-freshness.js";
import { parsePushInput } from "./parse-push-input.js";
import { resolveRepo, type RepoMatch } from "./resolve-repo.js";
import { scanOutgoing } from "./scan-outgoing.js";

export interface PrePushInput {
  /** `$1` from Git: the remote's name (or URL when pushing to a URL directly). */
  readonly remoteName: string;
  /** `$2` from Git: the effective push URL, after any `insteadOf` rewriting. */
  readonly remoteUrl: string;
  readonly stdin: string;
  readonly cwd: string;
}

export interface PrePushDeps {
  readonly store: ConfigStore;
  readonly git: GitPort;
  readonly events: EventSink;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly agentVersion: string;
  /** Cached server policy older than this is expired (ADR-004). */
  readonly maxStaleMinutes: number;
  /** Best-effort policy sync before deciding (short timeout). Failure never changes the decision rules. */
  readonly refresh?: () => Promise<void>;
  /** Best-effort: tell the server about root commits of a repo matched by remote (ADR-008). */
  readonly learn?: (matches: readonly RepoMatch[], pushUrl: string, cwd: string) => Promise<void>;
  /**
   * Asks the server whether an approved exception covers this project and destination (ADR-007). Only called when the
   * destination is the reason for blocking. Absent, failing or offline all mean "no exception".
   */
  readonly checkException?: (projectId: string, destinationRaw: string) => Promise<ExceptionCheck>;
}

export interface PrePushOutcome {
  /** 0 lets the push proceed; 1 blocks it. */
  readonly exitCode: 0 | 1;
  readonly lines: string[];
}

interface Known {
  project?: AgentProject;
  refs?: RefUpdate[];
}

function operationOf(refs: readonly RefUpdate[]): OperationType {
  if (refs.some((r) => r.forcePush)) return "force_push";
  if (refs.some((r) => r.kind === "delete")) return "branch_delete";
  if (refs.some((r) => r.remoteRef.startsWith("refs/tags/"))) return "tag_push";
  if (refs.some((r) => r.kind === "create")) return "branch_create";
  return "push";
}

/**
 * The pre-push hook. Decides allow (exit 0) or block (exit 1) for one `git push`.
 *
 * - A repo that resolves to no project is allowed silently (ADR-003). If the agent cannot tell (unreadable state, or a
 *   registered repo without a usable policy) it blocks: it never allows because it is blind.
 * - Otherwise `evaluatePush` (SH-4) decides. An internal error blocks in enforce mode and allows (recorded) in audit-only.
 * - Recording the event is best effort and never changes the outcome (ADR-004).
 */
export async function runPrePush(input: PrePushInput, deps: PrePushDeps): Promise<PrePushOutcome> {
  const correlationId = deps.newId();
  const known: Known = {};
  try {
    return await evaluate(input, deps, correlationId, known);
  } catch {
    const audit = known.project?.policy.mode === "audit_only";
    return finish(deps, known, correlationId, {
      result: audit ? "allowed" : "blocked",
      lines: formatCannotCheck("DevGuard hit an internal error while checking this push.", audit ? "allowed" : "blocked", correlationId),
      event: { outcome: "error", ruleIds: ["internal_error"], wouldBlock: true, mode: known.project?.policy.mode ?? null, findings: [], destination: null },
    });
  }
}

interface Finished {
  readonly result: "allowed" | "blocked";
  readonly lines: string[];
  readonly event: Pick<SecurityEventInput, "outcome" | "ruleIds" | "wouldBlock" | "mode" | "findings" | "destination"> & { exceptionId?: string };
}

async function finish(deps: PrePushDeps, known: Known, correlationId: string, done: Finished): Promise<PrePushOutcome> {
  const refs = known.refs ?? [];
  const event: SecurityEventInput = {
    idempotencyKey: deps.newId(),
    correlationId,
    occurredAt: deps.clock.now().toISOString(),
    projectId: known.project?.projectId ?? null,
    destination: done.event.destination,
    operation: operationOf(refs),
    refs: refs.map((r) => r.remoteRef),
    outcome: done.event.outcome,
    ruleIds: done.event.ruleIds,
    findings: done.event.findings.slice(0, 500),
    mode: done.event.mode,
    wouldBlock: done.event.wouldBlock,
    policyVersion: known.project?.policy.version ?? null,
    ...(done.event.exceptionId === undefined ? {} : { exceptionId: done.event.exceptionId }),
    agentVersion: deps.agentVersion,
  };
  const lines = [...done.lines];
  try {
    await deps.events.record(event);
  } catch {
    lines.push("DevGuard could not record this event in its local log.");
  }
  return { exitCode: done.result === "blocked" ? 1 : 0, lines };
}

function cannotCheck(deps: PrePushDeps, known: Known, correlationId: string, reason: string, rule: RuleId): Promise<PrePushOutcome> {
  return finish(deps, known, correlationId, {
    result: "blocked",
    lines: formatCannotCheck(reason, "blocked", correlationId),
    event: { outcome: "error", ruleIds: [rule], wouldBlock: true, mode: null, findings: [], destination: null },
  });
}

async function evaluate(input: PrePushInput, deps: PrePushDeps, correlationId: string, known: Known): Promise<PrePushOutcome> {
  const parsed = parsePushInput(input.stdin);
  if (!parsed.ok) return cannotCheck(deps, known, correlationId, "Git sent push information in a form DevGuard does not understand.", "internal_error");
  known.refs = parsed.value;

  // Offline or slow: the cache decides (ADR-004). A failed refresh changes nothing.
  await bestEffort(deps.refresh);

  const repoRoot = await deps.git.repoRoot(input.cwd);
  if (repoRoot === undefined) return cannotCheck(deps, known, correlationId, "The current directory is not a Git repository.", "internal_error");

  const mainRoot = await deps.git.mainWorktreeRoot(input.cwd);
  const resolved = await resolveRepo(deps, { cwd: input.cwd, repoRoots: mainRoot === undefined ? [repoRoot] : [repoRoot, mainRoot], pushUrl: input.remoteUrl });
  if (!resolved.ok) {
    const reason =
      resolved.reason === "state_unusable"
        ? "DevGuard's local state could not be read, so it cannot tell whether this repository is protected."
        : "This repository belongs to a protected project, but its policy is missing or unusable.";
    return cannotCheck(deps, known, correlationId, reason, "policy_unavailable");
  }
  if (!resolved.value.matched) return { exitCode: 0, lines: [] };

  // A repo can match several projects (ADR-003/008). Every one is evaluated and any one may block: a project
  // that is more permissive (or locally supplied) can never override a stricter one. The most restrictive
  // project's outcome is reported; a blocking one takes its place if the strictest would have allowed.
  // The most restrictive project governs if evaluation itself fails (enforce sorts before audit-only).
  known.project = resolved.value.project;
  const matches = resolved.value.projects;
  await bestEffort(deps.learn === undefined ? undefined : () => deps.learn?.(matches, input.remoteUrl, input.cwd) ?? Promise.resolve());
  const assessed: Assessed[] = [];
  for (const match of matches) {
    assessed.push(await assess(match, input, parsed.value, deps));
  }
  const chosen = assessed.find((a) => a.blocked) ?? assessed[0];
  if (chosen === undefined) return { exitCode: 0, lines: [] };
  known.project = chosen.project;
  known.refs = chosen.refs;
  return finish(deps, known, correlationId, chosen.finished(correlationId));
}

interface Assessed {
  readonly project: AgentProject;
  readonly refs: RefUpdate[];
  readonly blocked: boolean;
  readonly finished: (correlationId: string) => Finished;
}

async function bestEffort(task: (() => Promise<void>) | undefined): Promise<void> {
  try {
    await task?.();
  } catch {
    // Syncing and reporting are conveniences; the decision never depends on them succeeding.
  }
}

/** ADR-004: a server policy older than the limit is not trusted. Enforce blocks; audit-only allows and records. */
function expiredPolicy(project: AgentProject, input: PrePushInput, refs: RefUpdate[], deps: PrePushDeps): Assessed {
  const blocked = project.policy.mode !== "audit_only";
  const destination = normalizeDestination(input.remoteUrl);
  return {
    project,
    refs,
    blocked,
    finished: (correlationId) => ({
      result: blocked ? "blocked" : "allowed",
      lines: formatPolicyExpired({ projectName: project.name, mode: project.policy.mode, maxStaleMinutes: deps.maxStaleMinutes, blocked, correlationId }),
      event: { outcome: blocked ? "blocked" : "allowed", ruleIds: ["policy_unavailable"], wouldBlock: true, mode: project.policy.mode, findings: [], destination: destination.ok ? destination.value : null },
    }),
  };
}

async function assess(match: RepoMatch, input: PrePushInput, refsIn: RefUpdate[], deps: PrePushDeps): Promise<Assessed> {
  const { project } = match;
  if (match.source === "server" && classifyFreshness(match.fetchedAt, deps.clock.now(), deps.maxStaleMinutes) === "expired") {
    return expiredPolicy(project, input, refsIn, deps);
  }
  const { policy } = project;
  const scan = await scanOutgoing(deps.git, refsIn, input.remoteName, policy.secretRules, policy.prohibitedGlobs);
  const refs = refsIn.map((ref) => ({ ...ref, forcePush: scan.forcePush.get(ref.remoteRef) ?? false }));

  const evaluate = (exceptions: ValidException[]): Decision =>
    evaluatePush({ projectId: project.projectId, protected: true, policy, destinationRaw: input.remoteUrl, content: scan.findings, exceptions, now: deps.clock.now() });

  // The destination alone blocks: ask the server whether an approved exception exists. Anything but a clear "valid"
  // (no exception, server unreachable, error) leaves the block in place. Content findings are never waived by this.
  let decision: Decision = evaluate([]);
  let exceptionUnavailable = false;
  if (decision.outcome === "blocked" && decision.violatedRuleIds.includes("destination_not_approved") && deps.checkException !== undefined) {
    const check = await deps.checkException(project.projectId, input.remoteUrl).catch((): ExceptionCheck => ({ state: "unavailable" }));
    if (check.state === "valid") decision = evaluate([check.exception]);
    exceptionUnavailable = check.state === "unavailable";
  }

  const destination = normalizeDestination(input.remoteUrl);
  const mode: EnforcementMode = policy.mode;
  // Only an explicit audit-only mode may allow on error: any other value (even an unknown one) blocks.
  const blocked = decision.outcome === "blocked" || (decision.outcome === "error" && mode !== "audit_only");
  return {
    project,
    refs,
    blocked,
    finished: (correlationId) => ({
      result: blocked ? "blocked" : "allowed",
      lines: formatDecision({
        decision,
        projectName: project.name,
        classification: policy.classification,
        mode,
        destination: destination.ok ? destination.value : null,
        forcePushRefs: refs.filter((r) => r.forcePush).map((r) => r.remoteRef),
        correlationId,
        projectId: project.projectId,
        exceptionUnavailable,
      }),
      event: {
        outcome: decision.outcome,
        ruleIds: decision.violatedRuleIds,
        wouldBlock: decision.wouldBlock,
        mode,
        findings: decision.findings,
        destination: destination.ok ? destination.value : null,
        ...(decision.exceptionId === undefined ? {} : { exceptionId: decision.exceptionId }),
      },
    }),
  };
}
