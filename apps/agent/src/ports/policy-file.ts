import type { Result } from "../result.js";

export type PolicyFileReason = "unreadable" | "too_large" | "not_json";

/** Reads a project policy file the user names (`devguard register --policy-file`). Content is untrusted: validate it. */
export interface PolicyFileReader {
  read(path: string): Promise<Result<unknown, PolicyFileReason>>;
}
