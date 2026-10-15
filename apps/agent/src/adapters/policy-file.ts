import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import type { PolicyFileReader } from "../ports/policy-file.js";
import { fail, ok } from "../result.js";

const MAX_BYTES = 1024 * 1024;

/** A regular file of at most 1 MiB, opened without following a final symlink or blocking on a FIFO. */
export function createPolicyFileReader(): PolicyFileReader {
  return {
    async read(path) {
      let handle;
      try {
        handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const info = await handle.stat();
        if (!info.isFile()) return fail("unreadable");
        if (info.size > MAX_BYTES) return fail("too_large");
        const text = await handle.readFile({ encoding: "utf8" });
        try {
          return ok(JSON.parse(text) as unknown);
        } catch {
          return fail("not_json");
        }
      } catch {
        return fail("unreadable");
      } finally {
        await handle?.close();
      }
    },
  };
}
