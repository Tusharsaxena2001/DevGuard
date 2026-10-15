import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Run git synchronously in `cwd` and return trimmed stdout. Uses the sandboxed environment set up in test/setup.ts. */
export function git(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function initRepo(dir: string, options: { bare?: boolean } = {}): string {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main", ...(options.bare ? ["--bare"] : [])]);
  return dir;
}

/** Write files (path -> content; null deletes) and commit them. Returns the new commit sha. */
export function commit(repo: string, files: Record<string, string | null>, message = "commit"): string {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      git(repo, ["rm", "-q", "--", path]);
    } else {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), content);
      git(repo, ["add", "--", path]);
    }
  }
  git(repo, ["commit", "-q", "--allow-empty", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}
