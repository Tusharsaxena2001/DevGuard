import { describe, expect, it } from "vitest";
import { FindingSchema } from "@devguard/shared";
import { DEFAULT_PROHIBITED_GLOBS, findProhibitedFiles } from "./prohibited-files.js";

const C1 = "a".repeat(40);
const C2 = "b".repeat(40);

function flagged(paths: string[], globs: readonly string[] = DEFAULT_PROHIBITED_GLOBS): string[] {
  return findProhibitedFiles(
    paths.map((path) => ({ path, commit: C1 })),
    globs,
  ).map((f) => f.path);
}

describe("findProhibitedFiles with default globs", () => {
  it.each([
    ".env",
    "apps/api/.env",
    ".env.local",
    ".env.production",
    "keys/server.pem",
    "deploy.key",
    "home/.ssh/id_rsa",
    "id_ed25519",
    "id_ecdsa_work",
    "store.p12",
    "cert.pfx",
    ".npmrc",
    "packages/a/.npmrc",
    "credentials.json",
    "infra/credentials.json",
    "vault.kdbx",
    "SERVER.PEM",
    ".ENV",
    "id_dsa",
    "deep/er/.env.staging",
  ])("flags %s", (path) => {
    expect(flagged([path])).toEqual([path]);
  });

  it.each([
    ".env.example",
    "apps/api/.env.example",
    "id_rsa.pub",
    "id_ed25519.pub",
    "README.md",
    "src/environment.ts",
    "docs/env.md",
    "src/keys.ts",
    "pem.md",
    "credentials.json.md",
    "package.json",
    ".ssh/id_dsa.pub",
    "id_ecdsa.pub",
  ])("does not flag %s", (path) => {
    expect(flagged([path])).toEqual([]);
  });

  it("flags nothing for an empty file list", () => {
    expect(findProhibitedFiles([], DEFAULT_PROHIBITED_GLOBS)).toEqual([]);
  });
});

describe("findProhibitedFiles result shape", () => {
  it("returns kind, rule id, path and commit only", () => {
    expect(findProhibitedFiles([{ path: "a/.env", commit: C1 }], DEFAULT_PROHIBITED_GLOBS)).toEqual([
      { ruleId: "prohibited_file", kind: "prohibited_file", path: "a/.env", commit: C1 },
    ]);
  });

  it("reports one finding per file even when several globs match", () => {
    const findings = findProhibitedFiles([{ path: ".env", commit: C1 }], [".env", ".env*", "*"]);
    expect(findings).toHaveLength(1);
  });

  it("reports the same path in different commits separately and dedupes repeats", () => {
    const findings = findProhibitedFiles(
      [
        { path: ".env", commit: C1 },
        { path: ".env", commit: C2 },
        { path: ".env", commit: C1 },
      ],
      DEFAULT_PROHIBITED_GLOBS,
    );
    expect(findings.map((f) => f.commit)).toEqual([C1, C2]);
  });

  it("satisfies the shared Finding contract", () => {
    for (const f of findProhibitedFiles([{ path: ".env", commit: C1 }], DEFAULT_PROHIBITED_GLOBS)) {
      expect(FindingSchema.safeParse(f).success).toBe(true);
    }
  });

  it("flags a file added in one commit and deleted in a later one, once per commit", () => {
    const history = [
      { path: ".env", commit: C1, change: "added" },
      { path: ".env", commit: C2, change: "deleted" },
    ];
    const findings = findProhibitedFiles(history, DEFAULT_PROHIBITED_GLOBS);
    expect(findings.map((f) => f.commit)).toEqual([C1, C2]);
  });

  it("ignores extra fields on the input (e.g. a ChangedFile's change type)", () => {
    const file = { path: ".env", commit: C1, change: "deleted" as const };
    expect(findProhibitedFiles([file], DEFAULT_PROHIBITED_GLOBS)).toHaveLength(1);
  });
});

describe("findProhibitedFiles custom globs", () => {
  it("uses exactly the supplied globs (an empty list prohibits nothing)", () => {
    expect(flagged([".env", "a.pem"], [])).toEqual([]);
    expect(flagged([".env", "a.pem"], ["*.pem"])).toEqual(["a.pem"]);
  });

  it("lets an exemption win over a match regardless of order", () => {
    expect(flagged(["a/safe.pem", "a/real.pem"], ["!safe.pem", "*.pem"])).toEqual(["a/real.pem"]);
    expect(flagged(["a/safe.pem", "a/real.pem"], ["*.pem", "!safe.pem"])).toEqual(["a/real.pem"]);
  });

  it("exemptions are exact globs, not prefixes: lookalikes of an exempt name stay flagged", () => {
    expect(flagged([".env.example.bak", ".env.sample", ".env.example2"])).toEqual([
      ".env.example.bak",
      ".env.sample",
      ".env.example2",
    ]);
  });

  it("supports anchored, nested and case-insensitive exemptions", () => {
    const globs = ["*.pem", "!config/test.pem"];
    expect(flagged(["config/test.pem", "other/config/test.pem", "CONFIG/TEST.PEM"], globs)).toEqual([
      "other/config/test.pem",
    ]);
    expect(flagged(["a/.ENV.EXAMPLE"])).toEqual([]);
  });

  it.each(["*.{pem,key}", "*.[pP]em", "secrets/", "!*.{a,b}"])(
    "unsupported glob %s yields a scan_error instead of silently never matching",
    (glob) => {
      const findings = findProhibitedFiles([{ path: "a/x.pem", commit: C1 }], [glob]);
      expect(findings).toEqual([{ ruleId: "scan_error", kind: "scan_error", path: "a/x.pem", commit: C1 }]);
      expect(findings.every((f) => FindingSchema.safeParse(f).success)).toBe(true);
    },
  );

  it("still reports real matches next to an unsupported glob, and nothing when there are no files", () => {
    const findings = findProhibitedFiles([{ path: ".env", commit: C1 }], [".env", "x/"]);
    expect(findings.map((f) => f.kind)).toEqual(["scan_error", "prohibited_file"]);
    expect(findProhibitedFiles([], ["x/"])).toEqual([]);
  });

  it("an exemption alone flags nothing, and an empty or bare-bang glob matches nothing", () => {
    expect(flagged([".env"], ["!.env"])).toEqual([]);
    expect(flagged([".env"], ["", "!"])).toEqual([]);
  });
});
