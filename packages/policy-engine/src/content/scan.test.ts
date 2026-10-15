import { describe, expect, it } from "vitest";
import { FindingSchema } from "@devguard/shared";
import { scanAddedLines } from "./scan.js";
import { DEFAULT_SECRET_RULE_IDS, type SecretRule } from "./secret-rules.js";

const COMMIT = "c".repeat(40);

// Synthetic values assembled at runtime so no secret-shaped literal exists in the repo.
const alnum = (n: number, ch = "Q"): string => ch.repeat(n);
const synthetic = {
  privateKey: (kind = "RSA "): string => ["-----BEGIN", " ", kind, "PRIVATE KEY", "-----"].join(""),
  awsAkia: (): string => "AK" + "IA" + alnum(16, "7"),
  awsAsia: (): string => "AS" + "IA" + alnum(16, "Z"),
  githubPat: (): string => "gh" + "p_" + alnum(36),
  githubOauth: (): string => "gh" + "o_" + alnum(36, "x"),
  githubFine: (): string => "github" + "_pat_" + alnum(60, "a"),
  slack: (): string => "xo" + "xb-" + "1234567890-" + alnum(12, "z"),
  stripe: (): string => "sk" + "_live_" + alnum(24, "9"),
  google: (): string => "AI" + "za" + alnum(35, "k"),
  npm: (): string => "np" + "m_" + alnum(36, "n"),
  gitlab: (): string => "gl" + "pat-" + alnum(20, "g"),
  sendgrid: (): string => "S" + "G." + alnum(22, "s") + "." + alnum(43, "t"),
};

function scan(text: string, rules: readonly string[] = DEFAULT_SECRET_RULE_IDS): ReturnType<typeof scanAddedLines> {
  return scanAddedLines([{ path: "src/a.ts", commit: COMMIT, text }], rules);
}

describe("scanAddedLines detection", () => {
  const detected: [name: string, ruleId: string, text: string][] = [
    ["RSA private key header", "private_key_block", synthetic.privateKey()],
    ["bare private key header", "private_key_block", synthetic.privateKey("")],
    ["OpenSSH private key header", "private_key_block", synthetic.privateKey("OPENSSH ")],
    ["EC private key header", "private_key_block", synthetic.privateKey("EC ")],
    ["PGP private key block", "private_key_block", synthetic.privateKey("PGP ").replace("PRIVATE KEY", "PRIVATE KEY BLOCK")],
    ["AWS AKIA key", "aws_access_key_id", `aws_key = "${synthetic.awsAkia()}"`],
    ["AWS ASIA key", "aws_access_key_id", `KEY=${synthetic.awsAsia()}`],
    ["GitHub ghp token", "github_token", `token: ${synthetic.githubPat()}`],
    ["GitHub gho token", "github_token", synthetic.githubOauth()],
    ["GitHub fine-grained token", "github_token", `x=${synthetic.githubFine()}`],
    ["Slack token", "slack_token", `SLACK=${synthetic.slack()}`],
    ["Stripe live key", "provider_token", synthetic.stripe()],
    ["Google API key", "provider_token", synthetic.google()],
    ["npm token", "provider_token", synthetic.npm()],
    ["GitLab token", "provider_token", synthetic.gitlab()],
    ["SendGrid key", "provider_token", synthetic.sendgrid()],
  ];

  it.each(detected)("detects %s", (_name, ruleId, text) => {
    expect(scan(text)).toEqual([{ ruleId, kind: "secret", path: "src/a.ts", commit: COMMIT }]);
  });

  it("detects a secret embedded in a long line and in CRLF text", () => {
    expect(scan(`${"x ".repeat(5000)}${synthetic.githubPat()}${" y".repeat(5000)}`)).toHaveLength(1);
    expect(scan(`line\r\n${synthetic.awsAkia()}\r\n`)).toHaveLength(1);
  });

  it("reports each distinct rule that matches one line", () => {
    const findings = scan(`${synthetic.awsAkia()} ${synthetic.githubPat()}`);
    expect(findings.map((f) => f.ruleId)).toEqual(["aws_access_key_id", "github_token"]);
  });

  it("collapses repeats of one rule on one line, but not across lines", () => {
    expect(scan(`${synthetic.githubPat()} ${synthetic.githubOauth()}`)).toHaveLength(1);
    const lines = [1, 2].map((line) => ({ path: "a", commit: COMMIT, text: synthetic.githubPat(), line }));
    expect(scanAddedLines(lines, DEFAULT_SECRET_RULE_IDS).map((f) => f.line)).toEqual([1, 2]);
  });

  it("carries the optional line number and omits it when absent", () => {
    const [withLine] = scanAddedLines([{ path: "a", commit: COMMIT, text: synthetic.awsAkia(), line: 7 }], DEFAULT_SECRET_RULE_IDS);
    expect(withLine?.line).toBe(7);
    expect(scan(synthetic.awsAkia())[0]).not.toHaveProperty("line");
  });

  it("emits findings that satisfy the shared Finding contract", () => {
    for (const [, , text] of detected) {
      for (const finding of scan(text)) expect(FindingSchema.safeParse(finding).success).toBe(true);
    }
  });
});

describe("scanAddedLines boundaries", () => {
  const mixed = (n: number): string => "aB3_-".repeat(Math.ceil(n / 5)).slice(0, n);
  const alnumMixed = (n: number): string => "aB3x9".repeat(Math.ceil(n / 5)).slice(0, n);
  const hits = (text: string): number => scan(text).length;

  it.each([
    ["github ghp_ 36", "gh" + "p_" + alnumMixed(36), 1],
    ["github ghp_ 35", "gh" + "p_" + alnumMixed(35), 0],
    ["github ghu_", "gh" + "u_" + alnumMixed(36), 1],
    ["github ghs_", "gh" + "s_" + alnumMixed(36), 1],
    ["github ghr_", "gh" + "r_" + alnumMixed(36), 1],
    ["fine-grained 50", "github" + "_pat_" + mixed(50).replaceAll("-", "_"), 1],
    ["fine-grained 49", "github" + "_pat_" + mixed(49).replaceAll("-", "_"), 0],
    ["slack xoxa", "xo" + "xa-" + "1234567890", 1],
    ["slack xoxp", "xo" + "xp-" + "1234567890", 1],
    ["slack xoxr", "xo" + "xr-" + "1234567890", 1],
    ["slack xoxs", "xo" + "xs-" + "1234567890", 1],
    ["slack 9 chars", "xo" + "xb-" + "123456789", 0],
    ["stripe rk_live 24", "rk" + "_live_" + alnumMixed(24), 1],
    ["stripe sk_live 23", "sk" + "_live_" + alnumMixed(23), 0],
    ["google 35", "AI" + "za" + mixed(35), 1],
    ["google 34", "AI" + "za" + mixed(34), 0],
    ["npm 36", "np" + "m_" + alnumMixed(36), 1],
    ["npm 35", "np" + "m_" + alnumMixed(35), 0],
    ["gitlab 20", "gl" + "pat-" + mixed(20), 1],
    ["gitlab 19", "gl" + "pat-" + mixed(19), 0],
    ["sendgrid wrong segment lengths", "S" + "G." + alnumMixed(21) + "." + alnumMixed(43), 0],
    ["aws exactly 16 after prefix", "AK" + "IA" + "A".repeat(16), 1],
    ["aws 15 after prefix", "AK" + "IA" + "A".repeat(15), 0],
    ["aws preceded by uppercase", "X" + "AK" + "IA" + "A".repeat(16), 0],
    ["aws preceded by lowercase", "x" + "AK" + "IA" + "A".repeat(16), 1],
    ["aws lowercase prefix", "ak" + "ia" + "A".repeat(16), 0],
    ["encrypted private key", synthetic.privateKey("ENCRYPTED "), 1],
    ["dsa private key", synthetic.privateKey("DSA "), 1],
    ["private key header missing dashes", "BEGIN RSA PRIVATE KEY", 0],
    ["lowercase private key header", synthetic.privateKey().toLowerCase(), 0],
  ])("%s", (_name, text, expected) => {
    expect(hits(text)).toBe(expected);
  });

  it("finds adversarial long lines quickly (linear-time patterns)", () => {
    const started = Date.now();
    expect(scan("-----BEGIN " + "A ".repeat(50_000))).toEqual([]);
    expect(scan("-----BEGIN ".repeat(50_000))).toEqual([]);
    expect(scan(("gh" + "p_" + alnumMixed(35) + "-").repeat(20_000))).toEqual([]);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("scanAddedLines dedupe and attribution", () => {
  const secret = synthetic.githubPat();

  it("without line numbers, repeats in one file collapse to one finding; distinct paths and commits do not", () => {
    const at = (path: string, commit: string) => ({ path, commit, text: secret });
    expect(scanAddedLines([at("a", COMMIT), at("a", COMMIT)], DEFAULT_SECRET_RULE_IDS)).toHaveLength(1);
    expect(scanAddedLines([at("a", COMMIT), at("b", COMMIT)], DEFAULT_SECRET_RULE_IDS)).toHaveLength(2);
    expect(scanAddedLines([at("a", COMMIT), at("a", "d".repeat(40))], DEFAULT_SECRET_RULE_IDS)).toHaveLength(2);
  });

  it("keeps line 0 as given rather than dropping it", () => {
    const [f] = scanAddedLines([{ path: "a", commit: COMMIT, text: secret, line: 0 }], DEFAULT_SECRET_RULE_IDS);
    expect(f).toHaveProperty("line", 0);
  });
});

describe("scanAddedLines false positives", () => {
  it.each([
    ["prose about key formats", "AWS access key IDs start with AKIA or ASIA and are 20 characters long."],
    ["short AKIA prefix", "AKIA" + alnum(10, "A")],
    ["AWS id inside a longer uppercase run", "AKIA" + alnum(30, "A")],
    ["GitHub prefix only", "tokens begin with ghp_ or gho_ followed by characters"],
    ["too-short GitHub token", "gh" + "p_" + alnum(10)],
    ["Slack prefix only", "use an xoxb- bot token"],
    ["public key header", "-----BEGIN PUBLIC KEY-----"],
    ["certificate header", "-----BEGIN CERTIFICATE-----"],
    ["placeholder", "GITHUB_TOKEN=<your token here>"],
    ["short stripe-like", "sk" + "_live_" + alnum(5)],
    ["ordinary code", "const total = items.reduce((a, b) => a + b.price, 0);"],
    ["empty line", ""],
  ])("does not flag %s", (_name, text) => {
    expect(scan(text)).toEqual([]);
  });
});

describe("scanAddedLines never leaks matched text", () => {
  it("findings contain no part of the secret and only contract keys", () => {
    const secrets = [
      synthetic.awsAkia(),
      synthetic.githubPat(),
      synthetic.githubFine(),
      synthetic.slack(),
      synthetic.stripe(),
      synthetic.sendgrid(),
    ];
    const findings = scan(secrets.map((s) => `v=${s}`).join("\n"));
    expect(findings.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(findings);
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain(secret.slice(4, 14));
    }
    for (const f of findings) {
      expect(Object.keys(f).sort()).toEqual(["commit", "kind", "path", "ruleId"]);
    }
  });
});

describe("scanAddedLines rule selection and fail-safe", () => {
  it("only applies enabled rules; an empty list scans for nothing", () => {
    const text = `${synthetic.awsAkia()} ${synthetic.githubPat()}`;
    expect(scan(text, ["github_token"]).map((f) => f.ruleId)).toEqual(["github_token"]);
    expect(scan(text, [])).toEqual([]);
  });

  it("an unknown rule id with no lines yields nothing: there is nothing scanned to miss", () => {
    expect(scanAddedLines([], ["rule_from_the_future"])).toEqual([]);
  });

  it("attributes an unknown-rule scan_error to the first scanned line", () => {
    const lines = [
      { path: "first", commit: COMMIT, text: "x", line: 3 },
      { path: "second", commit: "d".repeat(40), text: "y" },
    ];
    expect(scanAddedLines(lines, ["nope"])).toEqual([
      { ruleId: "scan_error", kind: "scan_error", path: "first", commit: COMMIT, line: 3 },
    ]);
  });

  it("is not fooled by a catalog with duplicate ids or by duplicate enabled ids", () => {
    const dup = (id: string): SecretRule => ({ id, matches: () => false });
    const findings = scanAddedLines([{ path: "a", commit: COMMIT, text: "x" }], ["dup", "bogus"], [dup("dup"), dup("dup")]);
    expect(findings.map((f) => f.kind)).toEqual(["scan_error"]);
    expect(scanAddedLines([{ path: "a", commit: COMMIT, text: "x" }], ["dup", "dup"], [dup("dup")])).toEqual([]);
  });

  it("a throwing rule and an unknown id both surface; every error finding satisfies the Finding contract", () => {
    const boom: SecretRule = {
      id: "boom",
      matches: () => {
        throw new Error("x");
      },
    };
    const findings = scanAddedLines([{ path: "a", commit: COMMIT, text: "x" }], ["boom", "unknown"], [boom]);
    expect(findings.map((f) => f.kind)).toEqual(["scan_error", "scan_error"]);
    for (const f of findings) expect(FindingSchema.safeParse(f).success).toBe(true);
  });

  it("returns nothing for no lines", () => {
    expect(scanAddedLines([], DEFAULT_SECRET_RULE_IDS)).toEqual([]);
  });

  it("raises a scan_error when an enabled rule id is unknown (never silently skipped)", () => {
    const findings = scan("nothing here", ["github_token", "rule_from_the_future"]);
    expect(findings).toEqual([{ ruleId: "scan_error", kind: "scan_error", path: "src/a.ts", commit: COMMIT }]);
  });

  it("still reports real secrets alongside an unknown-rule scan_error", () => {
    const findings = scan(synthetic.githubPat(), ["github_token", "nope"]);
    expect(findings.map((f) => f.kind).sort()).toEqual(["scan_error", "secret"]);
  });

  it("turns a throwing rule into a scan_error finding and keeps scanning", () => {
    const boom: SecretRule = {
      id: "boom",
      matches: () => {
        throw new Error("detector crashed");
      },
    };
    const ok: SecretRule = { id: "ok", matches: (t) => t.includes("hit") };
    const findings = scanAddedLines(
      [
        { path: "a", commit: COMMIT, text: "hit", line: 1 },
        { path: "b", commit: COMMIT, text: "miss", line: 2 },
      ],
      ["boom", "ok"],
      [boom, ok],
    );
    expect(findings.map((f) => [f.ruleId, f.kind, f.path])).toEqual([
      ["scan_error", "scan_error", "a"],
      ["ok", "secret", "a"],
      ["scan_error", "scan_error", "b"],
    ]);
    expect(JSON.stringify(findings)).not.toContain("detector crashed");
  });

  it("is deterministic and does not mutate its input", () => {
    const lines = [{ path: "a", commit: COMMIT, text: synthetic.githubPat() }];
    const snapshot = JSON.stringify(lines);
    expect(scanAddedLines(lines, DEFAULT_SECRET_RULE_IDS)).toEqual(scanAddedLines(lines, DEFAULT_SECRET_RULE_IDS));
    expect(JSON.stringify(lines)).toBe(snapshot);
  });
});
