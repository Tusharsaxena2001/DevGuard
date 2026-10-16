import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentError } from "../../errors.js";
import type { ConfigStore } from "../../ports/config-store.js";
import { cachedPolicy, syntheticSecret } from "../../../test/support/fakes.js";
import { createFsConfigStore } from "./fs-config-store.js";

let root: string;
let home: string;
let store: ConfigStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "devguard-store-"));
  home = join(root, "home");
  store = createFsConfigStore(home);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const config = { serverUrl: "https://devguard.example.com", deviceId: "dev-1" };
const credentials = (): { deviceId: string; deviceSecret: string } => ({ deviceId: "dev-1", deviceSecret: syntheticSecret() });
const mode = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;
const isRoot = process.getuid?.() === 0;
const posix = process.platform !== "win32";
const run = promisify(execFile);

describe("reading before anything exists", () => {
  it("returns undefined for every file, lists no policies and creates nothing", async () => {
    expect(await store.readConfig()).toEqual({ ok: true, value: undefined });
    expect(await store.readCredentials()).toEqual({ ok: true, value: undefined });
    expect(await store.readRepos()).toEqual({ ok: true, value: undefined });
    expect(await store.readPolicy("proj-1")).toEqual({ ok: true, value: undefined });
    expect(await store.listPolicyIds()).toEqual({ ok: true, value: [] });
    await expect(stat(home)).rejects.toThrow();
  });
});

describe("round trips", () => {
  it("config", async () => {
    await store.writeConfig(config);
    expect(await store.readConfig()).toEqual({ ok: true, value: config });
  });

  it("credentials", async () => {
    const c = credentials();
    await store.writeCredentials(c);
    expect(await store.readCredentials()).toEqual({ ok: true, value: c });
  });

  it("registered repos", async () => {
    const repos = { repos: [{ repoPath: "/work/portal", projectId: "proj-1", registeredAt: "2026-06-01T12:00:00.000Z" }] };
    await store.writeRepos(repos);
    expect(await store.readRepos()).toEqual({ ok: true, value: repos });
  });

  it("policies, listed in sorted order", async () => {
    await store.writePolicy(cachedPolicy("proj-b"));
    await store.writePolicy(cachedPolicy("proj-a"));
    expect(await store.listPolicyIds()).toEqual({ ok: true, value: ["proj-a", "proj-b"] });
    expect(await store.readPolicy("proj-a")).toEqual({ ok: true, value: cachedPolicy("proj-a") });
  });

  it("deletes a cached policy, and deleting a missing one is fine", async () => {
    await store.writePolicy(cachedPolicy("proj-a"));
    await store.writePolicy(cachedPolicy("proj-b"));
    await store.deletePolicy("proj-a");
    await store.deletePolicy("proj-a");
    await store.deletePolicy("never-existed");
    expect(await store.listPolicyIds()).toEqual({ ok: true, value: ["proj-b"] });
  });

  it.each([["../escape"], ["a/b"], [""], [".hidden"]])("refuses to delete a policy with the unsafe id %j", async (id) => {
    await expect(store.deletePolicy(id)).rejects.toMatchObject({ code: "store_write_failed" });
  });

  it("keeps the policy source and the sync ETag through a round trip", async () => {
    await store.writePolicy({ ...cachedPolicy("proj-a"), source: "server" });
    expect(await store.readPolicy("proj-a")).toEqual({ ok: true, value: { ...cachedPolicy("proj-a"), source: "server" } });
    await store.writeConfig({ ...config, projectsEtag: '"abc"', lastContactAt: "2026-06-01T12:00:00.000Z" });
    expect(await store.readConfig()).toEqual({ ok: true, value: { ...config, projectsEtag: '"abc"', lastContactAt: "2026-06-01T12:00:00.000Z" } });
  });

  it("overwrites an existing file and leaves no temp files behind", async () => {
    await store.writeConfig(config);
    await store.writeConfig({ ...config, deviceId: "dev-2" });
    expect(await store.readConfig()).toMatchObject({ ok: true, value: { deviceId: "dev-2" } });
    expect(await readdir(home)).toEqual(["config.json"]);
  });
});

describe("file permissions", () => {
  it.skipIf(process.platform === "win32")("creates files 0600 and directories 0700", async () => {
    await store.writeCredentials(credentials());
    await store.writeConfig(config);
    await store.writePolicy(cachedPolicy());
    expect(await mode(home)).toBe(0o700);
    expect(await mode(join(home, "policies"))).toBe(0o700);
    for (const file of ["credentials.json", "config.json", "policies/proj-1.json"]) expect(await mode(join(home, file))).toBe(0o600);
  });

  it.skipIf(process.platform === "win32").each([0o644, 0o640, 0o604, 0o660, 0o666, 0o777])(
    "refuses credentials with mode %o without reading them",
    async (m) => {
      await store.writeCredentials(credentials());
      await chmod(join(home, "credentials.json"), m);
      expect(await store.readCredentials()).toEqual({ ok: false, reason: "insecure_permissions" });
    },
  );

  it.skipIf(process.platform === "win32")("accepts credentials again once the mode is fixed", async () => {
    await store.writeCredentials(credentials());
    await chmod(join(home, "credentials.json"), 0o644);
    await chmod(join(home, "credentials.json"), 0o600);
    expect((await store.readCredentials()).ok).toBe(true);
  });

  it.skipIf(process.platform === "win32")("accepts a read-only 0400 credentials file", async () => {
    await store.writeCredentials(credentials());
    await chmod(join(home, "credentials.json"), 0o400);
    expect((await store.readCredentials()).ok).toBe(true);
  });

  it.skipIf(!posix)("refuses credentials that are a symlink, even to a private valid file", async () => {
    await store.writeCredentials(credentials());
    await writeFile(join(root, "real.json"), JSON.stringify(credentials()), { mode: 0o600 });
    await rm(join(home, "credentials.json"));
    await symlink(join(root, "real.json"), join(home, "credentials.json"));
    expect(await store.readCredentials()).toEqual({ ok: false, reason: "insecure_permissions" });
  });

  it("refuses credentials that are a directory, even a private one", async () => {
    await mkdir(join(home, "credentials.json"), { recursive: true, mode: 0o700 });
    expect(await store.readCredentials()).toEqual({ ok: false, reason: "insecure_permissions" });
  });

  it("treats a config path that is a directory as invalid", async () => {
    await mkdir(join(home, "config.json"), { recursive: true, mode: 0o700 });
    expect(await store.readConfig()).toEqual({ ok: false, reason: "invalid" });
  });

  it.skipIf(!posix)("does not follow a symlinked config file", async () => {
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeFile(join(root, "real.json"), JSON.stringify(config), { mode: 0o600 });
    await symlink(join(root, "real.json"), join(home, "config.json"));
    expect(await store.readConfig()).toEqual({ ok: false, reason: "invalid" });
  });

  it.skipIf(isRoot || process.platform === "win32")("reports a file the user cannot read", async () => {
    await store.writeConfig(config);
    await chmod(join(home, "config.json"), 0o000);
    expect(await store.readConfig()).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("validation on read", () => {
  const put = async (name: string, content: string): Promise<void> => {
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeFile(join(home, name), content, { mode: 0o600 });
  };

  it.each([
    ["not JSON", "{nope"],
    ["empty file", ""],
    ["a JSON array", "[]"],
    ["missing field", JSON.stringify({ serverUrl: "https://x.example.com" })],
    ["extra field", JSON.stringify({ ...config, extra: 1 })],
    ["file: URL", JSON.stringify({ ...config, serverUrl: "file:///etc/passwd" })],
    ["ftp: URL", JSON.stringify({ ...config, serverUrl: "ftp://x.example.com" })],
    ["not a URL", JSON.stringify({ ...config, serverUrl: "devguard.example.com" })],
  ])("config.json with %s is invalid", async (_n, content) => {
    await put("config.json", content);
    expect(await store.readConfig()).toEqual({ ok: false, reason: "invalid" });
  });

  it("credentials missing the secret are invalid", async () => {
    await put("credentials.json", JSON.stringify({ deviceId: "dev-1" }));
    expect(await store.readCredentials()).toEqual({ ok: false, reason: "invalid" });
  });

  it("a file larger than the size cap is invalid", async () => {
    await put("repos.json", `{"repos":[]}${" ".repeat(9 * 1024 * 1024)}`);
    expect(await store.readRepos()).toEqual({ ok: false, reason: "invalid" });
  });

  it("an invalid file does not affect the others", async () => {
    await put("config.json", "{nope");
    await store.writeCredentials(credentials());
    expect((await store.readCredentials()).ok).toBe(true);
  });
});

describe("writes", () => {
  it("refuse invalid data, create nothing and do not echo the data", async () => {
    const bad = { serverUrl: "ftp://leak-" + syntheticSecret(), deviceId: "d" };
    const error = await store.writeConfig(bad).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).code).toBe("store_write_failed");
    expect((error as AgentError).message).not.toContain(syntheticSecret());
    await expect(stat(join(home, "config.json"))).rejects.toThrow();
  });

  it("remove their temp file when the final rename fails", async () => {
    await mkdir(join(home, "config.json"), { recursive: true, mode: 0o700 });
    await expect(store.writeConfig(config)).rejects.toMatchObject({ code: "store_write_failed" });
    expect(await readdir(home)).toEqual(["config.json"]);
  });

  it("report a typed error and leave no temp file when the directory cannot be created", async () => {
    await writeFile(join(root, "blocker"), "x");
    const blocked = createFsConfigStore(join(root, "blocker", "home"));
    const error = await blocked.writeCredentials(credentials()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).code).toBe("store_write_failed");
    expect((error as AgentError).message).not.toContain(syntheticSecret());
    expect(await readdir(root)).toEqual(["blocker"]);
  });
});

describe("policy cache", () => {
  it.each(["../evil", "a/b", "", ".hidden", "a.b", "-x", "a b", "x".repeat(129)])(
    "rejects unsafe project id %j on read and write without touching the disk",
    async (id) => {
      expect(await store.readPolicy(id)).toEqual({ ok: false, reason: "invalid" });
      await expect(store.writePolicy(cachedPolicy(id))).rejects.toMatchObject({ code: "store_write_failed" });
      await expect(stat(home)).rejects.toThrow();
    },
  );

  it("lists every .json name, so oddly named files are reported (as invalid) rather than hidden", async () => {
    await store.writePolicy(cachedPolicy("proj-1"));
    for (const name of [".x.json", "bad name.json", "notes.txt", "proj-2.json.tmp", ".proj-1.json.abc.tmp"]) {
      await writeFile(join(home, "policies", name), "{}", { mode: 0o600 });
    }
    expect(await store.listPolicyIds()).toEqual({ ok: true, value: [".x", "bad name", "proj-1"] });
    expect(await store.readPolicy(".x")).toEqual({ ok: false, reason: "invalid" });
  });

  it.skipIf(isRoot || !posix)("a policies directory that cannot be listed is unreadable, never an empty list", async () => {
    await store.writePolicy(cachedPolicy());
    await chmod(join(home, "policies"), 0o300);
    try {
      expect(await store.listPolicyIds()).toEqual({ ok: false, reason: "unreadable" });
    } finally {
      await chmod(join(home, "policies"), 0o700);
    }
  });

  it("a policies path that is a file is invalid, not an empty list", async () => {
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeFile(join(home, "policies"), "not a directory");
    expect(await store.listPolicyIds()).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a cache file that holds a different project than its name", async () => {
    await store.writePolicy(cachedPolicy("proj-a"));
    await writeFile(join(home, "policies", "proj-b.json"), JSON.stringify(cachedPolicy("proj-a")), { mode: 0o600 });
    expect(await store.readPolicy("proj-b")).toEqual({ ok: false, reason: "invalid" });
  });

  it("treats a malformed policy file as invalid", async () => {
    await mkdir(join(home, "policies"), { recursive: true, mode: 0o700 });
    await writeFile(join(home, "policies", "proj-1.json"), JSON.stringify({ fetchedAt: "yesterday", project: {} }), { mode: 0o600 });
    expect(await store.readPolicy("proj-1")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("isolation", () => {
  it("two homes never see each other's state", async () => {
    const other = createFsConfigStore(join(root, "other"));
    await store.writeConfig(config);
    expect(await other.readConfig()).toEqual({ ok: true, value: undefined });
    await other.writeCredentials(credentials());
    expect(await store.readCredentials()).toEqual({ ok: true, value: undefined });
  });
});

describe("trust checks before reading", () => {
  const put = async (name: string, content: string, m = 0o600): Promise<void> => {
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeFile(join(home, name), content, { mode: m });
    await chmod(join(home, name), m);
  };

  it.skipIf(!posix)("checks permissions before parsing: a loose-mode file with garbage is insecure, not invalid", async () => {
    await put("credentials.json", "{garbage", 0o644);
    expect(await store.readCredentials()).toEqual({ ok: false, reason: "insecure_permissions" });
  });

  it.skipIf(!posix).each([0o700, 0o500, 0o400, 0o600])("accepts credentials with owner-only mode %o", async (m) => {
    await put("credentials.json", JSON.stringify(credentials()), m);
    expect((await store.readCredentials()).ok).toBe(true);
  });

  it.skipIf(!posix)("accepts a world-readable config (it is not secret) but refuses one others can write", async () => {
    await put("config.json", JSON.stringify(config), 0o644);
    expect((await store.readConfig()).ok).toBe(true);
    for (const m of [0o664, 0o646, 0o666]) {
      await chmod(join(home, "config.json"), m);
      expect(await store.readConfig()).toEqual({ ok: false, reason: "insecure_permissions" });
    }
  });

  it.skipIf(!posix)("refuses a state directory that others can write, for every kind of read", async () => {
    await store.writeConfig(config);
    await store.writeCredentials(credentials());
    await store.writePolicy(cachedPolicy());
    await chmod(home, 0o777);
    const refused = { ok: false, reason: "insecure_permissions" };
    expect(await store.readConfig()).toEqual(refused);
    expect(await store.readCredentials()).toEqual(refused);
    expect(await store.readRepos()).toEqual(refused);
    expect(await store.readPolicy("proj-1")).toEqual(refused);
    expect(await store.listPolicyIds()).toEqual(refused);
    await chmod(home, 0o700);
    expect((await store.readCredentials()).ok).toBe(true);
  });

  it.skipIf(!posix)("refuses a policies directory that others can write", async () => {
    await store.writePolicy(cachedPolicy());
    await chmod(join(home, "policies"), 0o777);
    expect(await store.readPolicy("proj-1")).toEqual({ ok: false, reason: "insecure_permissions" });
    expect(await store.listPolicyIds()).toEqual({ ok: false, reason: "insecure_permissions" });
  });

  it("a state directory that is a file is invalid; one under a file is unreadable (never 'missing')", async () => {
    await writeFile(join(root, "afile"), "x");
    expect(await createFsConfigStore(join(root, "afile")).readConfig()).toEqual({ ok: false, reason: "invalid" });
    expect(await createFsConfigStore(join(root, "afile", "sub")).readConfig()).toEqual({ ok: false, reason: "unreadable" });
  });

  it.skipIf(!posix)("a FIFO planted as credentials is refused promptly instead of hanging the read", async () => {
    await mkdir(home, { recursive: true, mode: 0o700 });
    await run("mkfifo", [join(home, "credentials.json")]);
    const outcome = await Promise.race([
      store.readCredentials(),
      new Promise<string>((resolve) => setTimeout(() => resolve("HUNG"), 3000)),
    ]);
    expect(outcome).toEqual({ ok: false, reason: "insecure_permissions" });
  });
});

describe("schema limits", () => {
  const put = async (name: string, value: unknown): Promise<void> => {
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeFile(join(home, name), JSON.stringify(value), { mode: 0o600 });
  };

  it.each([
    ["https", "https://devguard.example.com", true],
    ["https with a path and port", "https://devguard.example.com:8443/api", true],
    ["http to localhost", "http://localhost:3000", true],
    ["http to 127.0.0.1", "http://127.0.0.1:3000", true],
    ["http to ::1", "http://[::1]:3000", true],
    ["http to a remote host (cleartext secret)", "http://devguard.example.com", false],
    ["http to a lookalike of localhost", "http://localhost.evil.example", false],
    ["userinfo", "https://user:pw@devguard.example.com", false],
    ["username only", "https://token@devguard.example.com", false],
    ["query string", "https://devguard.example.com/?token=x", false],
    ["fragment", "https://devguard.example.com/#x", false],
    ["longer than 2048", `https://devguard.example.com/${"a".repeat(2048)}`, false],
  ])("serverUrl %s", async (_n, serverUrl, accepted) => {
    await put("config.json", { serverUrl, deviceId: "dev-1" });
    expect((await store.readConfig()).ok).toBe(accepted);
  });

  it("serverUrl with credentials is also refused on write, without echoing it", async () => {
    const error = await store.writeConfig({ serverUrl: "https://u:" + syntheticSecret() + "@x.example.com", deviceId: "d" }).catch((e: unknown) => e);
    expect((error as AgentError).code).toBe("store_write_failed");
    expect((error as AgentError).message).not.toContain(syntheticSecret());
  });

  it.each([
    ["empty secret", { deviceId: "d", deviceSecret: "" }],
    ["secret over 512", { deviceId: "d", deviceSecret: "x".repeat(513) }],
    ["extra field", { deviceId: "d", deviceSecret: "x", note: 1 }],
  ])("credentials with %s are invalid", async (_n, value) => {
    await put("credentials.json", value);
    expect(await store.readCredentials()).toEqual({ ok: false, reason: "invalid" });
  });

  it("repos with an extra field are invalid", async () => {
    await put("repos.json", { repos: [], extra: true });
    expect(await store.readRepos()).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("atomic writes keep the previous content safe", () => {
  it("a refused invalid write leaves the existing file intact", async () => {
    await store.writeConfig(config);
    await expect(store.writeConfig({ serverUrl: "ftp://x", deviceId: "d" })).rejects.toMatchObject({ code: "store_write_failed" });
    expect(await store.readConfig()).toEqual({ ok: true, value: config });
  });

  it("a failed rename leaves the existing content intact", async () => {
    await store.writeConfig(config);
    await mkdir(join(home, "policies"), { recursive: true, mode: 0o700 });
    await mkdir(join(home, "policies", "proj-1.json"));
    await expect(store.writePolicy(cachedPolicy())).rejects.toMatchObject({ code: "store_write_failed" });
    expect(await readFile(join(home, "config.json"), "utf8")).toContain("dev-1");
  });

  it("concurrent writes never collide or leave partial files", async () => {
    await Promise.all(["a", "b", "c", "d", "e"].map((id) => store.writeConfig({ ...config, deviceId: `dev-${id}` })));
    const read = await store.readConfig();
    expect(read.ok && read.value?.deviceId).toMatch(/^dev-[a-e]$/);
    expect(await readdir(home)).toEqual(["config.json"]);
  });

  it.skipIf(!posix)("rewriting a loose-mode credentials file replaces it with a 0600 one", async () => {
    await store.writeCredentials(credentials());
    await chmod(join(home, "credentials.json"), 0o644);
    await store.writeCredentials(credentials());
    expect(await mode(join(home, "credentials.json"))).toBe(0o600);
    expect((await store.readCredentials()).ok).toBe(true);
  });
});
