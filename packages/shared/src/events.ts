import { z } from "zod";
import { EnforcementModeSchema, OperationTypeSchema, OutcomeSchema, RuleIdSchema } from "./enums.js";
import { IdSchema, IsoDateTimeSchema } from "./common.js";
import { FindingSchema } from "./findings.js";

/**
 * Event sent by the agent. Identity (employee/device) is NOT part of the body: the server
 * derives it from the device credential. Minimal metadata only; no contents (ADR-005).
 */
export const SecurityEventInputSchema = z
  .object({
    /** Client-generated; the server treats repeated keys as duplicates. */
    idempotencyKey: z.string().min(8).max(128),
    correlationId: z.string().min(8).max(128),
    occurredAt: IsoDateTimeSchema,
    projectId: IdSchema.nullable(),
    /** Null when the remote URL could not be parsed (treated as unapproved). */
    destination: z
      .object({ host: z.string().min(1).max(255), repoPath: z.string().min(1).max(512) })
      .strict()
      .nullable(),
    operation: OperationTypeSchema,
    refs: z.array(z.string().max(512)).max(1000),
    outcome: OutcomeSchema,
    ruleIds: z.array(RuleIdSchema).max(20),
    findings: z.array(FindingSchema).max(500),
    mode: EnforcementModeSchema.nullable(),
    wouldBlock: z.boolean(),
    policyVersion: z.number().int().positive().nullable(),
    exceptionId: IdSchema.optional(),
    agentVersion: z.string().min(1).max(32),
  })
  .strict();
export type SecurityEventInput = z.infer<typeof SecurityEventInputSchema>;

export const SecurityEventBatchSchema = z
  .object({ events: z.array(SecurityEventInputSchema).min(1).max(100) })
  .strict();
export type SecurityEventBatch = z.infer<typeof SecurityEventBatchSchema>;
