import { randomBytes } from "node:crypto";
import { chmod, link, mkdir, open, readFile, rename, rmdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { AgentError } from "../../errors.js";
import type { HookFiles } from "../../ports/hook-files.js";

const fail = (what: string, path: string, cause: unknown): AgentError =>
  new AgentError("hook_files_failed", `Could not ${what} ${path}.`, { cause });

/** `HookFiles` over the file system. Writes are atomic (temp file + rename) and never follow a symlink at the target. */
export function createFsHookFiles(): HookFiles {
  return {
    async read(path) {
      try {
        const info = await stat(path);
        if (!info.isFile()) return undefined;
        return await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw fail("read", path, error);
      }
    },

    async writeExecutable(path, content) {
      const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
      try {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const handle = await open(temp, "wx", 0o755);
        try {
          await handle.writeFile(content, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await chmod(temp, 0o755);
        await rename(temp, path);
      } catch (error) {
        await unlink(temp).catch(() => undefined);
        throw fail("write", path, error);
      }
    },

    async move(from, to) {
      try {
        // link + unlink instead of rename: fails if `to` exists instead of silently replacing it.
        await link(from, to);
        await unlink(from);
      } catch (error) {
        throw fail("move", from, error);
      }
    },

    async remove(path) {
      try {
        await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw fail("remove", path, error);
      }
    },

    async removeDirIfEmpty(path) {
      try {
        await rmdir(path);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST") throw fail("remove", path, error);
      }
    },
  };
}
