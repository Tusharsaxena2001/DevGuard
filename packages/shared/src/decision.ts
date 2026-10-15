import { z } from "zod";
import { OutcomeSchema, RuleIdSchema } from "./enums.js";
import { FindingSchema } from "./findings.js";

/** Result of evaluating a push. Produced by the policy engine, consumed by agent and API. */
export const DecisionSchema = z
  .object({
    outcome: OutcomeSchema,
    /** Primary rule that determined the outcome. */
    ruleId: RuleIdSchema,
    /** Human-readable explanations; must never contain file contents or secret values. */
    reasons: z.array(z.string().max(500)).max(100),
    findings: z.array(FindingSchema).max(10_000),
    /** True when audit-only mode allowed a push that enforce mode would have blocked. */
    wouldBlock: z.boolean(),
    /** All violated rule ids, deduplicated, in deterministic order. */
    violatedRuleIds: z.array(RuleIdSchema).max(20),
    exceptionId: z.string().min(1).max(128).optional(),
  })
  .strict();
export type Decision = z.infer<typeof DecisionSchema>;
