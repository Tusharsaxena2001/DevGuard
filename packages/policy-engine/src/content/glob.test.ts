import { describe, expect, it } from "vitest";
import { compileGlob, isSupportedGlob } from "./glob.js";

describe("compileGlob", () => {
  const cases: [pattern: string, path: string, expected: boolean][] = [
    // slashless patterns match the basename at any depth
    [".env", ".env", true],
    [".env", "apps/api/.env", true],
    [".env", "apps/api/.env.local", false],
    [".env", "not.env", false],
    [".env.*", "apps/api/.env.production", true],
    [".env.*", ".env", false],
    ["*.pem", "certs/server.pem", true],
    ["*.pem", "certs/server.pem.txt", false],
    ["*.pem", "certs.pem/readme.md", false],
    ["id_rsa*", "home/.ssh/id_rsa", true],
    ["id_rsa*", "id_rsa_work", true],
    ["id_rsa*", "my_id_rsa", false],
    ["?.key", "a.key", true],
    ["?.key", "ab.key", false],
    // case-insensitive
    [".env", ".ENV", true],
    ["*.PEM", "server.pem", true],
    // patterns with a slash match the full path
    ["config/secrets.json", "config/secrets.json", true],
    ["config/secrets.json", "app/config/secrets.json", false],
    ["config/*.json", "config/a.json", true],
    ["config/*.json", "config/sub/a.json", false],
    ["config/**", "config/sub/deep/a.json", true],
    ["config/a?b", "config/a-b", true],
    ["config/a?b", "config/a/b", false],
    ["**/secrets.json", "secrets.json", true],
    ["**/secrets.json", "a/b/secrets.json", true],
    ["**/secrets.json", "a/b/not-secrets.json", false],
    // `/**/` means zero or more directories (Git semantics)
    ["config/**/secrets.json", "config/secrets.json", true],
    ["config/**/secrets.json", "config/a/secrets.json", true],
    ["config/**/secrets.json", "config/a/b/secrets.json", true],
    ["config/**/secrets.json", "other/secrets.json", false],
    ["config/**/secrets.json", "config/a/secrets.json.bak", false],
    ["a/**/b/**/c", "a/b/x/c", true],
    ["a/**/b/**/c", "a/x/b/c", true],
    ["a/**/b/**/c", "a/b/c", true],
    ["a/**/b", "a/xb", false],
    // a leading slash anchors to the repository root
    ["/.env", ".env", true],
    ["/.env", "apps/.env", false],
    // every other character is literal (no regex semantics)
    ["a.b", "axb", false],
    ["a.b", "a.b", true],
    ["*.pem", "apem", false],
    [".env", "xenv", false],
    ["a+b", "aab", false],
    ["a(b)", "ab", false],
    ["a$", "a", false],
    // degenerate patterns
    ["", "anything", false],
    ["*", "file", true],
    ["*", "dir/file", true], // slashless: basename
    ["**", "a/b", true],
  ];

  it.each(cases)("%s vs %s -> %s", (pattern, path, expected) => {
    expect(compileGlob(pattern)(path)).toBe(expected);
  });

  it.each([
    ["stars", `${"*a".repeat(40)}b`, "a".repeat(1000)],
    ["globstars", `${"**/a".repeat(40)}/b`, "a/".repeat(500)],
    ["dirs and ?", `x/${"**/?".repeat(40)}/b`, `x/${"a/".repeat(500)}`],
  ])("stays fast on pathological %s (no backtracking blow-up)", (_name, pattern, path) => {
    const started = Date.now();
    expect(compileGlob(pattern)(path)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("isSupportedGlob", () => {
  it.each(["*.pem", ".env", "a/**/b", "**/x?.key", "/.env", "id_rsa*"])("accepts %s", (g) => {
    expect(isSupportedGlob(g)).toBe(true);
  });

  it.each(["*.{pem,key}", "*.[pP]em", "a\\.b", "secrets/", "{a}", "x]"])("rejects %s", (g) => {
    expect(isSupportedGlob(g)).toBe(false);
  });
});
