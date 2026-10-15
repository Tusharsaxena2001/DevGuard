import { z } from "zod";
import { GitShaSchema, RepoPathSchema } from "./common.js";

export const FindingKindSchema = z.enum(["prohibited_file", "secret", "scan_error"]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

/**
 * A policy finding. Deliberately has no field for matched text, file contents or
 * secret values: only the rule, the kind, and where it was found.
 */
export const FindingSchema = z
  .object({
    ruleId: z.string().min(1).max(64),
    kind: FindingKindSchema,
    path: RepoPathSchema,
    commit: GitShaSchema.optional(),
    line: z.number().int().positive().optional(),
  })
  .strict();
export type Finding = z.infer<typeof FindingSchema>;

export const FileChangeTypeSchema = z.enum(["added", "modified", "deleted", "renamed"]);
export type FileChangeType = z.infer<typeof FileChangeTypeSchema>;

export const RefUpdateKindSchema = z.enum(["create", "update", "delete"]);

/** One line of the Git pre-push stdin contract, interpreted. */
export const RefUpdateSchema = z
  .object({
    localRef: z.string().max(512),
    localSha: GitShaSchema,
    remoteRef: z.string().min(1).max(512),
    remoteSha: GitShaSchema,
    kind: RefUpdateKindSchema,
    forcePush: z.boolean(),
  })
  .strict();
export type RefUpdate = z.infer<typeof RefUpdateSchema>;

export const ChangedFileSchema = z
  .object({
    path: RepoPathSchema,
    commit: GitShaSchema,
    change: FileChangeTypeSchema,
  })
  .strict();
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

/** Metadata about outgoing commits. Paths and change types only, never content. */
export const OutgoingChangeSummarySchema = z
  .object({
    refs: z.array(RefUpdateSchema).max(1000),
    commitCount: z.number().int().nonnegative(),
    files: z.array(ChangedFileSchema).max(100_000),
  })
  .strict();
export type OutgoingChangeSummary = z.infer<typeof OutgoingChangeSummarySchema>;
