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

/**
 * What the server did with each event of a batch, in order. `rejected` is final (the device is not assigned to that
 * project): the agent drops it instead of retrying forever. A transport or 5xx failure answers the whole call, and
 * then the agent keeps the batch.
 */
export const EventResultSchema = z
  .object({ idempotencyKey: z.string(), status: z.enum(["accepted", "duplicate", "rejected"]) })
  .strict();
export type EventResult = z.infer<typeof EventResultSchema>;

export const EventBatchResultSchema = z.object({ results: z.array(EventResultSchema).max(100) }).strict();
export type EventBatchResult = z.infer<typeof EventBatchResultSchema>;

/**
 * An event as shown in the dashboard. It evidences that the hook observed a push attempt and what it decided;
 * it does not prove whether data was or was not exfiltrated.
 */
export const SecurityEventEntrySchema = z
  .object({
    id: IdSchema,
    occurredAt: IsoDateTimeSchema,
    receivedAt: IsoDateTimeSchema,
    deviceId: IdSchema,
    deviceName: z.string(),
    userId: IdSchema,
    userName: z.string(),
    projectId: IdSchema.nullable(),
    projectName: z.string().nullable(),
    destination: z.object({ host: z.string(), repoPath: z.string() }).strict().nullable(),
    operation: OperationTypeSchema,
    refs: z.array(z.string()),
    outcome: OutcomeSchema,
    ruleIds: z.array(z.string()),
    findings: z.array(FindingSchema),
    mode: EnforcementModeSchema.nullable(),
    wouldBlock: z.boolean(),
    policyVersion: z.number().int().positive().nullable(),
    exceptionId: IdSchema.nullable(),
    correlationId: z.string(),
    agentVersion: z.string(),
  })
  .strict();
export type SecurityEventEntry = z.infer<typeof SecurityEventEntrySchema>;

/** Query string of `GET /events`. Everything optional; `page` starts at 1. */
export const EventQuerySchema = z
  .object({
    projectId: z.uuid().optional(),
    deviceId: z.uuid().optional(),
    userId: z.uuid().optional(),
    outcome: OutcomeSchema.optional(),
    ruleId: z.string().min(1).max(64).optional(),
    correlationId: z.string().min(1).max(128).optional(),
    destHost: z.string().min(1).max(255).optional(),
    destRepo: z.string().min(1).max(512).optional(),
    from: IsoDateTimeSchema.optional(),
    to: IsoDateTimeSchema.optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  // Deep offsets are expensive and nobody pages that far by hand: narrow the filters instead.
  .refine((q) => q.page * q.pageSize <= 20_000, { message: "page is too deep; narrow the filters", path: ["page"] });
export type EventQuery = z.infer<typeof EventQuerySchema>;

export const EventPageSchema = z
  .object({ items: z.array(SecurityEventEntrySchema), total: z.number().int().min(0), page: z.number().int().min(1), pageSize: z.number().int().min(1) })
  .strict();
export type EventPage = z.infer<typeof EventPageSchema>;
