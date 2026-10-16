import { z } from "zod";
import { ExceptionStatusSchema, type ExceptionStatus } from "./enums.js";
import { IdSchema, IsoDateTimeSchema, NormalizedDestinationSchema } from "./common.js";

/** Developer request. `destination` is the raw URL; the server normalizes it. */
export const ExceptionRequestInputSchema = z
  .object({
    projectId: IdSchema,
    destination: z.string().min(1).max(2048),
    reason: z.string().trim().min(10).max(1000),
    eventId: IdSchema.optional(),
  })
  .strict();
export type ExceptionRequestInput = z.infer<typeof ExceptionRequestInputSchema>;

export const ExceptionDecisionInputSchema = z
  .object({
    reason: z.string().trim().min(10).max(1000),
    expiresAt: IsoDateTimeSchema,
  })
  .strict();
export type ExceptionDecisionInput = z.infer<typeof ExceptionDecisionInputSchema>;

export const ExceptionRejectionInputSchema = z
  .object({ reason: z.string().trim().min(10).max(1000) })
  .strict();
export type ExceptionRejectionInput = z.infer<typeof ExceptionRejectionInputSchema>;

/** A server-issued approval, scoped to one project and one normalized destination. */
export const ValidExceptionSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    destination: NormalizedDestinationSchema,
    status: ExceptionStatusSchema,
    expiresAt: IsoDateTimeSchema,
    approverId: IdSchema,
    requesterId: IdSchema,
    /** Rule ids this exception additionally waives. Empty by default (ADR-007). */
    waivedRuleIds: z.array(z.string().min(1).max(64)).max(50),
  })
  .strict();
export type ValidException = z.infer<typeof ValidExceptionSchema>;

export const ExceptionValidationRequestSchema = z
  .object({
    projectId: IdSchema,
    destination: z.string().min(1).max(2048),
  })
  .strict();

export const ExceptionValidationResultSchema = z
  .object({
    valid: z.boolean(),
    exceptionId: IdSchema.optional(),
    expiresAt: IsoDateTimeSchema.optional(),
    approverId: IdSchema.optional(),
    /** Who the exception was issued to. Lets the agent rebuild a `ValidException` for the policy engine. */
    requesterId: IdSchema.optional(),
    waivedRuleIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .strict();
export type ExceptionValidationResult = z.infer<typeof ExceptionValidationResultSchema>;

export const ExceptionDecisionEntrySchema = z
  .object({
    decision: z.enum(["approved", "rejected", "revoked"]),
    deciderId: IdSchema,
    deciderName: z.string(),
    reason: z.string(),
    expiresAt: IsoDateTimeSchema.nullable(),
    decidedAt: IsoDateTimeSchema,
  })
  .strict();
export type ExceptionDecisionEntry = z.infer<typeof ExceptionDecisionEntrySchema>;

/**
 * An exception request with its history. `status` is the effective status: an approved exception whose time has
 * passed reads `expired` (expiry is evaluated when read and when validated, never by a background job).
 */
export const ExceptionEntrySchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    projectName: z.string(),
    requesterId: IdSchema,
    requesterName: z.string(),
    deviceId: IdSchema.nullable(),
    destination: NormalizedDestinationSchema,
    reason: z.string(),
    status: ExceptionStatusSchema,
    eventId: IdSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    /** Of the latest approval, while it is in force. */
    expiresAt: IsoDateTimeSchema.nullable(),
    decisions: z.array(ExceptionDecisionEntrySchema),
  })
  .strict();
export type ExceptionEntry = z.infer<typeof ExceptionEntrySchema>;

export const ExceptionQuerySchema = z
  .object({
    status: ExceptionStatusSchema.optional(),
    projectId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ExceptionQuery = z.infer<typeof ExceptionQuerySchema>;

export const ExceptionPageSchema = z
  .object({ items: z.array(ExceptionEntrySchema), total: z.number().int().min(0), page: z.number().int().min(1), pageSize: z.number().int().min(1) })
  .strict();
export type ExceptionPage = z.infer<typeof ExceptionPageSchema>;

/** Is `status` a state in which a request can still be decided? */
export const isDecidable = (status: ExceptionStatus): boolean => status === "pending";
