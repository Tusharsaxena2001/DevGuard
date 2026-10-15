import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { z } from "zod";
import { AgentError } from "../../errors.js";
import { fail, ok, type Result } from "../../result.js";
import type { StoreRead, StoreReadReason } from "../../ports/config-store.js";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
/** Refuse to follow a symlink at the final path component (not defined on Windows, where it is simply 0). */
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
/** Opening a FIFO or device read-only would block until a writer appears; this makes the open return so it can be refused. */
const NONBLOCK = constants.O_NONBLOCK ?? 0;

/**
 * POSIX only (the agent targets macOS and Linux; on Windows these checks do nothing). A path is untrusted when
 * it belongs to another user, or when other users can write to it (`strict`: or even read it, for secrets).
 */
function untrusted(info: Stats, strict: boolean): boolean {
  if (process.platform === "win32") return false;
  const foreignOwner = typeof process.geteuid === "function" && info.uid !== process.geteuid();
  return foreignOwner || (info.mode & (strict ? 0o077 : 0o022)) !== 0;
}

/**
 * Check a directory that holds state before trusting anything in it: it must be a directory owned by this user that
 * other users cannot write to (they could otherwise replace files). A missing directory is fine (nothing stored yet).
 */
export async function checkDirectory(dir: string): Promise<Result<undefined, StoreReadReason>> {
  let info: Stats;
  try {
    info = await stat(dir);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? ok(undefined) : fail("unreadable");
  }
  if (!info.isDirectory()) return fail("invalid");
  return untrusted(info, false) ? fail("insecure_permissions") : ok(undefined);
}

/**
 * Read and validate a JSON file. A missing file is `ok(undefined)`. A symlink, a non-regular file (FIFO, directory),
 * a file owned by someone else or one that others can write is refused before its contents are read; with
 * `requirePrivate` (credentials) a file others can even read is refused too. The checks run on the opened handle, so
 * the file cannot be swapped between check and read.
 */
export async function readJsonFile<S extends z.ZodType>(
  path: string,
  schema: S,
  options: { requirePrivate: boolean },
): Promise<StoreRead<z.infer<S>>> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return ok(undefined);
    if (code === "ELOOP") return fail(options.requirePrivate ? "insecure_permissions" : "invalid");
    return fail("unreadable");
  }

  try {
    const info = await handle.stat();
    if (!info.isFile()) return fail(options.requirePrivate ? "insecure_permissions" : "invalid");
    if (untrusted(info, options.requirePrivate)) return fail("insecure_permissions");
    if (info.size > MAX_FILE_BYTES) return fail("invalid");

    let json: unknown;
    try {
      json = JSON.parse(await handle.readFile({ encoding: "utf8" }));
    } catch {
      return fail("invalid");
    }
    const parsed = schema.safeParse(json);
    return parsed.success ? ok(parsed.data) : fail("invalid");
  } catch {
    return fail("unreadable");
  } finally {
    await handle.close();
  }
}

/**
 * Validate, then write atomically: a private temp file in the same directory is flushed and renamed over the
 * target, so readers see the old or the new content, never a partial file. Files are 0600, directories 0700.
 * Failures are reported without file contents.
 */
export async function writeJsonFile<S extends z.ZodType>(path: string, schema: S, value: z.input<S>): Promise<void> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AgentError("store_write_failed", `Refusing to write invalid data to ${basename(path)}.`);

  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIR_MODE });
    const handle = await open(temp, "wx", PRIVATE_FILE_MODE);
    try {
      await handle.writeFile(`${JSON.stringify(parsed.data, null, 2)}\n`, { encoding: "utf8" });
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw new AgentError("store_write_failed", `Could not write ${basename(path)} in ${dirname(path)}.`, { cause: error });
  }
}
