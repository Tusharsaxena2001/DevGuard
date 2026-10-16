import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";

/** One administrative change. History is append-only: there is no way to edit or delete one through the API. */
export const AuditEntrySchema = z
  .object({
    id: IdSchema,
    occurredAt: IsoDateTimeSchema,
    actorId: IdSchema,
    actorName: z.string(),
    action: z.string(),
    targetType: z.string(),
    targetId: z.string(),
    /** Redacted, flat summary: ids, names, counts and status words. Never credentials or file contents. */
    summary: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })
  .strict();
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditQuerySchema = z
  .object({
    actorId: z.uuid().optional(),
    /** Exact action, e.g. `policy.updated`. */
    action: z.string().min(1).max(64).optional(),
    /** Action family, e.g. `exception` matches `exception.approved`. */
    actionPrefix: z.string().min(1).max(64).optional(),
    targetType: z.string().min(1).max(64).optional(),
    targetId: z.string().min(1).max(128).optional(),
    from: IsoDateTimeSchema.optional(),
    to: IsoDateTimeSchema.optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .refine((q) => q.page * q.pageSize <= 20_000, { message: "page is too deep; narrow the filters", path: ["page"] });
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

export const AuditPageSchema = z
  .object({ items: z.array(AuditEntrySchema), total: z.number().int().min(0), page: z.number().int().min(1), pageSize: z.number().int().min(1) })
  .strict();
export type AuditPage = z.infer<typeof AuditPageSchema>;
