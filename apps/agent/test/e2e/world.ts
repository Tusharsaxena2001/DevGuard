import { execFileSync, spawnSync } from "node:child_process";
import { expect } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProject } from "@devguard/shared";
import { createFsConfigStore } from "../../src/adapters/fs-store/fs-config-store.js";
import { commit, git, initRepo } from "../support/git-repo.js";

export const MAIN = fileURLToPath(new URL("../../dist/main.js", import.meta.url));
export const APPROVED = "git@github.com:acme/portal.git";
export const UNAPPROVED = "git@github.com:personal/fork.git";

/** A synthetic secret assembled at runtime. */
export const secret = (): string => "gh" + "p_" + "Q".repeat(36);

export interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * A throwaway machine: its own HOME, global git config, DevGuard state, and a directory of bare repos that stand in
 * for remotes. `git@github.com:<owner>/<repo>.git` URLs are routed to `<remotes>/<owner>/<repo>.git` by a fake ssh
 * command, so the hook sees realistic remote URLs while pushes land in local bare repos.
 */
export class World {
  readonly dir = mkdtempSync(join(tmpdir(), "devguard-e2e-"));
  readonly home = join(this.dir, "home");
  readonly state = join(this.dir, "state");
  readonly remotes = join(this.dir, "remotes");
  readonly repo = join(this.dir, "work", "portal");
  private readonly env: Record<string, string>;

  constructor() {
    mkdirSync(this.home, { recursive: true });
    mkdirSync(this.remotes, { recursive: true });
    const fakeSsh = join(this.dir, "fake-ssh");
    writeFileSync(fakeSsh, `#!/bin/sh\ncd '${this.remotes}' && exec sh -c "$2"\n`);
    chmodSync(fakeSsh, 0o755);
    this.env = {
      HOME: this.home,
      GIT_CONFIG_GLOBAL: join(this.home, ".gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
      XDG_CONFIG_HOME: join(this.dir, "xdg"),
      GIT_SSH_COMMAND: fakeSsh,
      DEVGUARD_HOME: this.state,
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@example.com",
    };
    initRepo(this.repo);
    this.addRemote("origin", APPROVED);
  }

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** Create a bare repo for `git@github.com:<path>` and add a remote pointing at that URL. */
  addRemote(name: string, url: string): string {
    const bare = join(this.remotes, url.split(":")[1] ?? "");
    initRepo(bare, { bare: true });
    git(this.repo, ["remote", "add", name, url], this.env);
    return bare;
  }

  /** Run any command in the sandboxed environment. Never throws. */
  run(command: string, args: string[], cwd = this.repo, input?: string): Run {
    const result = spawnSync(command, args, { cwd, env: { ...process.env, ...this.env }, encoding: "utf8", input });
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  }

  git(args: string[], cwd = this.repo): Run {
    return this.run("git", args, cwd);
  }

  gitOk(args: string[], cwd = this.repo): string {
    return git(cwd, args, this.env);
  }

  devguard(args: string[], cwd = this.repo): Run {
    return this.run(process.execPath, [MAIN, ...args], cwd);
  }

  commit(files: Record<string, string | null>, message = "commit"): string {
    return commit(this.repo, files, message);
  }

  refsOf(bare: string): string {
    return execFileSync("git", ["for-each-ref", "--format=%(refname) %(objectname)"], { cwd: bare, encoding: "utf8" });
  }

  /** Protect the work repo: register it and cache a policy for the project. */
  async protect(over: (p: AgentProject) => void = () => undefined): Promise<void> {
    const project: AgentProject = {
      projectId: "proj-1",
      name: "Portal",
      policy: {
        version: 1,
        mode: "enforce",
        classification: "confidential",
        destinations: [{ host: "github.com", repoPath: "acme/portal", type: "exact" }],
        prohibitedGlobs: [".env", "*.pem"],
        secretRules: ["github_token", "aws_access_key_id", "private_key_block"],
      },
      canonicalRepos: [{ host: "github.com", repoPath: "acme/portal" }],
      fingerprints: [],
    };
    over(project);
    const store = createFsConfigStore(this.state);
    const root = this.gitOk(["rev-parse", "--show-toplevel"]);
    await store.writePolicy({ fetchedAt: "2026-06-01T12:00:00.000Z", project });
    await store.writeRepos({ repos: [{ repoPath: root, projectId: "proj-1", registeredAt: "2026-06-01T12:00:00.000Z" }] });
  }

  /** A blocked push must be DevGuard's doing: its message on stderr, and a recorded `blocked` event. */
  expectBlocked(push: Run, ...texts: string[]): void {
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("DevGuard blocked this push.");
    for (const text of texts) expect(push.stderr).toContain(text);
    expect(this.events().at(-1)).toMatchObject({ outcome: "blocked" });
  }

  events(): Record<string, unknown>[] {
    try {
      return readFileSync(join(this.state, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    } catch {
      return [];
    }
  }
}
