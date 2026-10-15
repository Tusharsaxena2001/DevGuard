import { z } from "zod";
import { ExceptionStatusSchema } from "./enums.js";
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
    waivedRuleIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .strict();
export type ExceptionValidationResult = z.infer<typeof ExceptionValidationResultSchema>;
