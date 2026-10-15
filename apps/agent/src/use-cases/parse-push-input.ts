import { RefUpdateSchema, type RefUpdate } from "@devguard/shared";
import { fail, ok, type Result } from "../result.js";

export type ParsePushReason = "malformed_line" | "too_many_refs";

const LINE = /^(\S+) ([0-9a-f]{40}|[0-9a-f]{64}) (\S+) ([0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_REFS = 1000;

const isZero = (sha: string): boolean => /^0+$/.test(sha);

export const isDeletion = (ref: RefUpdate): boolean => ref.kind === "delete";

/**
 * Interpret the pre-push stdin contract: one `<local-ref> <local-sha> <remote-ref> <remote-sha>` line per ref.
 * Anything that does not match exactly is rejected (the caller blocks): never guess what Git meant.
 * `forcePush` starts false; the runner fills it in once it can ask Git about ancestry.
 */
export function parsePushInput(stdin: string): Result<RefUpdate[], ParsePushReason> {
  const lines = stdin.split("\n").filter((line) => line.length > 0);
  if (lines.length > MAX_REFS) return fail("too_many_refs");

  const refs: RefUpdate[] = [];
  for (const line of lines) {
    const match = LINE.exec(line.replace(/\r$/, ""));
    if (!match) return fail("malformed_line");
    const [, localRef = "", localSha = "", remoteRef = "", remoteSha = ""] = match;
    if (localSha.length !== remoteSha.length) return fail("malformed_line"); // one repository has one hash algorithm
    const candidate = {
      localRef,
      localSha,
      remoteRef,
      remoteSha,
      kind: isZero(localSha) ? "delete" : isZero(remoteSha) ? "create" : "update",
      forcePush: false,
    };
    const parsed = RefUpdateSchema.safeParse(candidate);
    if (!parsed.success) return fail("malformed_line");
    refs.push(parsed.data);
  }
  return ok(refs);
}
