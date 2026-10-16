import { z } from "zod";
import { GitShaSchema, IdSchema, IsoDateTimeSchema } from "./common.js";
import { ClassificationSchema, EnforcementModeSchema } from "./enums.js";

const NameSchema = z.string().trim().min(1).max(200);

export const CreateProjectRequestSchema = z.object({ name: NameSchema, classification: ClassificationSchema }).strict();
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const UpdateProjectRequestSchema = z
  .object({ name: NameSchema.optional(), classification: ClassificationSchema.optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.classification !== undefined, "nothing to update");
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;

export const ProjectSummarySchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    classification: ClassificationSchema,
    ownerId: IdSchema,
    createdAt: IsoDateTimeSchema,
    memberIds: z.array(IdSchema),
  })
  .strict();
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

/** Replaces the set of employees assigned to a project. Only assigned employees' devices receive it at sync. */
export const SetMembersRequestSchema = z.object({ userIds: z.array(z.uuid()).max(1000) }).strict();
export type SetMembersRequest = z.infer<typeof SetMembersRequestSchema>;

/** A Git remote as typed by an admin. The server normalizes it (policy-engine) and rejects anything unusual. */
export const RemoteUrlRequestSchema = z.object({ url: z.string().min(1).max(2048) }).strict();
export type RemoteUrlRequest = z.infer<typeof RemoteUrlRequestSchema>;

export const DestinationEntrySchema = z
  .object({ id: IdSchema, host: z.string(), repoPath: z.string(), type: z.enum(["exact", "owner_wildcard"]), createdAt: IsoDateTimeSchema })
  .strict();
export type DestinationEntry = z.infer<typeof DestinationEntrySchema>;

export const CanonicalRepoEntrySchema = z.object({ id: IdSchema, host: z.string(), repoPath: z.string(), createdAt: IsoDateTimeSchema }).strict();
export type CanonicalRepoEntry = z.infer<typeof CanonicalRepoEntrySchema>;

export const AddFingerprintRequestSchema = z.object({ fingerprint: GitShaSchema }).strict();
export type AddFingerprintRequest = z.infer<typeof AddFingerprintRequestSchema>;

export const FingerprintEntrySchema = z
  .object({
    id: IdSchema,
    fingerprint: GitShaSchema,
    source: z.enum(["device", "manual"]),
    reportedByDeviceId: IdSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type FingerprintEntry = z.infer<typeof FingerprintEntrySchema>;

/** Device report (ADR-008): "my repo with this remote has this root commit". The remote must match the project. */
export const ReportFingerprintRequestSchema = z
  .object({ projectId: z.uuid(), fingerprint: GitShaSchema, remote: z.string().min(1).max(2048) })
  .strict();
export type ReportFingerprintRequest = z.infer<typeof ReportFingerprintRequestSchema>;

/** Manual registration of the repo a device is in (the fallback in ADR-003/008). */
export const RegisterRepoRequestSchema = z.object({ fingerprint: GitShaSchema }).strict();
export type RegisterRepoRequest = z.infer<typeof RegisterRepoRequestSchema>;

export const RepoRegistrationEntrySchema = z
  .object({ id: IdSchema, deviceId: IdSchema, deviceName: z.string(), fingerprint: GitShaSchema, registeredAt: IsoDateTimeSchema })
  .strict();
export type RepoRegistrationEntry = z.infer<typeof RepoRegistrationEntrySchema>;

/** New policy version. `baseVersion` is the version the editor started from; a newer one on the server is a conflict. */
export const PolicyUpdateRequestSchema = z
  .object({
    baseVersion: z.number().int().positive(),
    mode: EnforcementModeSchema,
    prohibitedGlobs: z.array(z.string().min(1).max(256)).max(500),
    secretRules: z.array(z.string().min(1).max(64)).max(100),
  })
  .strict();
export type PolicyUpdateRequest = z.infer<typeof PolicyUpdateRequestSchema>;

export const PolicyVersionEntrySchema = z
  .object({
    version: z.number().int().positive(),
    mode: EnforcementModeSchema,
    prohibitedGlobs: z.array(z.string()),
    secretRules: z.array(z.string()),
    createdBy: IdSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type PolicyVersionEntry = z.infer<typeof PolicyVersionEntrySchema>;
