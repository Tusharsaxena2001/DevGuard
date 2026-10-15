import { z } from "zod";
import { ClassificationSchema, EnforcementModeSchema } from "./enums.js";
import { GitShaSchema, IdSchema, NormalizedDestinationSchema } from "./common.js";

/** `exact` = host + repoPath equality. `owner_wildcard` = same host, any repo under repoPath's owner. */
export const ApprovedDestinationSchema = z
  .object({
    id: IdSchema.optional(),
    host: z.string().min(1).max(255),
    repoPath: z.string().min(1).max(512),
    type: z.enum(["exact", "owner_wildcard"]),
  })
  .strict();
export type ApprovedDestination = z.infer<typeof ApprovedDestinationSchema>;

export const ProjectPolicySchema = z
  .object({
    version: z.number().int().positive(),
    mode: EnforcementModeSchema,
    classification: ClassificationSchema,
    destinations: z.array(ApprovedDestinationSchema).max(500),
    prohibitedGlobs: z.array(z.string().min(1).max(256)).max(500),
    /** Ids of enabled secret-detection rules. */
    secretRules: z.array(z.string().min(1).max(64)).max(100),
  })
  .strict();
export type ProjectPolicy = z.infer<typeof ProjectPolicySchema>;

/** One project as synced to an enrolled device (ADR-008). */
export const AgentProjectSchema = z
  .object({
    projectId: IdSchema,
    name: z.string().min(1).max(200),
    policy: ProjectPolicySchema,
    canonicalRepos: z.array(NormalizedDestinationSchema).max(100),
    /** Root-commit hashes that identify this project's repos regardless of remote URL. */
    fingerprints: z.array(GitShaSchema).max(1000),
  })
  .strict();
export type AgentProject = z.infer<typeof AgentProjectSchema>;

export const AgentProjectSyncSchema = z
  .object({
    projects: z.array(AgentProjectSchema).max(1000),
    syncedAt: z.iso.datetime(),
  })
  .strict();
export type AgentProjectSync = z.infer<typeof AgentProjectSyncSchema>;
