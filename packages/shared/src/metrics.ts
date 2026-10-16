import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";
import { OutcomeSchema } from "./enums.js";
import { SecurityEventEntrySchema } from "./events.js";

export const MetricsRangeSchema = z.enum(["24h", "7d", "30d"]);
export type MetricsRange = z.infer<typeof MetricsRangeSchema>;

export const MetricsQuerySchema = z.object({ range: MetricsRangeSchema.default("7d") }).strict();
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;

/**
 * Dashboard numbers, computed from the database on request. They count events the hook reported; they say nothing
 * about pushes made with `--no-verify`, from other Git clients or on devices without the agent.
 */
export const MetricsSummarySchema = z
  .object({
    range: MetricsRangeSchema,
    since: IsoDateTimeSchema,
    generatedAt: IsoDateTimeSchema,
    /** Events by decision in the range (outcomes with no events are present with 0). */
    outcomes: z.record(OutcomeSchema, z.number().int().min(0)),
    totalEvents: z.number().int().min(0),
    topRules: z.array(z.object({ ruleId: z.string(), count: z.number().int().min(1) }).strict()).max(10),
    blockedPerDay: z.array(z.object({ day: z.string(), projectId: IdSchema.nullable(), projectName: z.string().nullable(), blocked: z.number().int().min(1) }).strict()),
    exceptions: z.object({ pending: z.number().int().min(0), inForce: z.number().int().min(0) }).strict(),
    devices: z.object({ active: z.number().int().min(0), stale: z.number().int().min(0), revoked: z.number().int().min(0) }).strict(),
    recentIncidents: z.array(SecurityEventEntrySchema).max(10),
  })
  .strict();
export type MetricsSummary = z.infer<typeof MetricsSummarySchema>;
