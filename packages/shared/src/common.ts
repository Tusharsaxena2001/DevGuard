import { z } from "zod";

/** Full 40-char (SHA-1) or 64-char (SHA-256) lowercase hex Git object id. */
export const GitShaSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, "invalid git sha");
export type GitSha = z.infer<typeof GitShaSchema>;

/** Repo-relative path as reported by Git. Bounded; never a place for file contents. */
export const RepoPathSchema = z.string().min(1).max(1024);

export const IdSchema = z.string().min(1).max(128);

export const IsoDateTimeSchema = z.iso.datetime();

/** Canonical form of a Git remote: lowercase host plus owner/repo path, no `.git`, no credentials. */
export const NormalizedDestinationSchema = z
  .object({
    host: z.string().min(1).max(255),
    repoPath: z.string().min(1).max(512),
  })
  .strict();
export type NormalizedDestination = z.infer<typeof NormalizedDestinationSchema>;
