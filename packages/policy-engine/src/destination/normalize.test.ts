import { describe, expect, it } from "vitest";
import { normalizeDestination } from "./normalize.js";

const GH = { host: "github.com", repoPath: "acme-corp/portal" };

describe("normalizeDestination: accepted forms", () => {
  it.each([
    ["https", "https://github.com/acme-corp/portal", GH],
    ["https with .git", "https://github.com/acme-corp/portal.git", GH],
    ["https trailing slash", "https://github.com/acme-corp/portal/", GH],
    ["https upper-case host and path (case-insensitive host)", "https://GitHub.COM/Acme-Corp/Portal.git", GH],
    ["https default port dropped", "https://github.com:443/acme-corp/portal", GH],
    ["https plain username dropped", "https://priya@github.com/acme-corp/portal.git", GH],
    ["https trailing dot host", "https://github.com./acme-corp/portal", GH],
    ["https upper-case scheme", "HTTPS://github.com/acme-corp/portal", GH],
    ["scp-style", "git@github.com:acme-corp/portal.git", GH],
    ["scp-style without .git", "git@github.com:acme-corp/portal", GH],
    ["scp-style absolute path", "git@github.com:/acme-corp/portal.git", GH],
    ["ssh:// form", "ssh://git@github.com/acme-corp/portal.git", GH],
    ["ssh:// default port dropped", "ssh://git@github.com:22/acme-corp/portal.git", GH],
    ["surrounding whitespace trimmed", "  https://github.com/acme-corp/portal.git\n", GH],
    ["nested groups (gitlab)", "https://gitlab.com/Group/Sub/Repo.git", { host: "gitlab.com", repoPath: "group/sub/repo" }],
    ["non-default port kept", "https://git.corp.example:8443/team/app.git", { host: "git.corp.example:8443", repoPath: "team/app" }],
    ["ssh non-default port kept", "ssh://git@git.corp.example:2222/team/app", { host: "git.corp.example:2222", repoPath: "team/app" }],
    ["ssh port 443 is not the ssh default", "ssh://git@github.com:443/acme-corp/portal", { host: "github.com:443", repoPath: "acme-corp/portal" }],
    ["unknown host keeps path case", "https://git.corp.example/Team/App", { host: "git.corp.example", repoPath: "Team/App" }],
    ["case-insensitive host strips .GIT", "https://github.com/Acme-Corp/Portal.GIT", GH],
    [
      "case-sensitive host does NOT strip .GIT (distinct repo name)",
      "https://git.corp.example/org/repo.GIT",
      { host: "git.corp.example", repoPath: "org/repo.GIT" },
    ],
    ["case-sensitive host strips lowercase .git", "https://git.corp.example/org/repo.git", { host: "git.corp.example", repoPath: "org/repo" }],
    ["tilde owner", "https://git.sr.ht/~user/repo", { host: "git.sr.ht", repoPath: "~user/repo" }],
  ])("%s", (_name, input, expected) => {
    expect(normalizeDestination(input)).toEqual({ ok: true, value: expected });
  });

  it("different spellings of the same remote normalize identically", () => {
    const forms = [
      "https://github.com/acme-corp/portal",
      "https://github.com/acme-corp/portal.git",
      "git@github.com:acme-corp/portal.git",
      "ssh://git@github.com/acme-corp/portal.git",
      "HTTPS://GITHUB.COM:443/ACME-CORP/PORTAL/",
    ].map((f) => normalizeDestination(f));
    for (const result of forms) expect(result).toEqual({ ok: true, value: GH });
  });
});

describe("normalizeDestination: rejected (fail-safe)", () => {
  it.each([
    // userinfo tricks and credentials
    ["host-like userinfo trick", "https://github.com@evil.example/acme-corp/portal", "invalid_userinfo"],
    ["double @", "https://a@github.com@evil.example/acme-corp/portal", "multiple_at"],
    ["password in URL", "https://user:s3cret@github.com/acme-corp/portal", "credentials_in_url"],
    ["token as password", "https://x-access-token:abc@github.com/acme-corp/portal", "credentials_in_url"],
    ["scp @ trick", "git@github.com@evil.example:acme-corp/portal", "unsupported_scheme"],
    ["scp host-like user", "github.com@evil.example:acme-corp/portal", "invalid_userinfo"],
    ["scp leading-dash username", "-oProxyCommand@github.com:acme-corp/portal", "invalid_userinfo"],
    ["https leading-dash username", "https://-v@github.com/acme-corp/portal", "invalid_userinfo"],
    ["ssh leading-dash username", "ssh://-v@github.com/acme-corp/portal", "invalid_userinfo"],
    // lookalike hosts are normalised faithfully and so can never equal the real one (see match tests); malformed ones fail
    ["empty label", "https://github..com/acme-corp/portal", "invalid_host"],
    ["leading hyphen label", "https://-github.com/acme-corp/portal", "invalid_host"],
    ["underscore host", "https://git_hub.com/acme-corp/portal", "invalid_host"],
    ["ipv6 literal", "https://[::1]/acme-corp/portal", "invalid_host"],
    ["empty host", "https:///acme-corp/portal", "invalid_host"],
    ["extra colon in host", "https://github.com:80:90/acme-corp/portal", "invalid_host"],
    ["port zero", "https://github.com:0/acme-corp/portal", "invalid_port"],
    ["port too large", "https://github.com:70000/acme-corp/portal", "invalid_port"],
    ["empty port", "https://github.com:/acme-corp/portal", "invalid_port"],
    ["port leading zero", "https://github.com:0443/acme-corp/portal", "invalid_port"],
    // schemes and local paths
    ["http (cleartext)", "http://github.com/acme-corp/portal", "unsupported_scheme"],
    ["git protocol", "git://github.com/acme-corp/portal", "unsupported_scheme"],
    ["file url", "file:///tmp/repo.git", "unsupported_scheme"],
    ["ext transport", "ext::sh -c touch% /tmp/x", "invalid_characters"],
    ["ext transport no space", "ext::sshfoo", "unsupported_scheme"],
    ["absolute local path", "/srv/git/repo.git", "local_path"],
    ["relative local path", "../repo.git", "local_path"],
    ["home local path", "~/repo.git", "local_path"],
    ["bare word", "origin", "unsupported_scheme"],
    ["scp without user", "github.com:acme-corp/portal", "unsupported_scheme"],
    // characters
    ["empty", "", "empty"],
    ["whitespace only", "   ", "empty"],
    ["interior space", "https://github.com/acme corp/portal", "invalid_characters"],
    ["tab inside", "https://github.com/acme\tcorp/portal", "invalid_characters"],
    ["newline inside", "https://github.com/acme\ncorp/portal", "invalid_characters"],
    ["NUL byte", "https://github.com/acme\u0000/portal", "invalid_characters"],
    ["backslash", "https://github.com\\@evil.example/acme-corp/portal", "invalid_characters"],
    ["percent-encoding", "https://github.com/acme%2Fcorp/portal", "percent_encoding"],
    ["cyrillic homoglyph host", "https://g\u0456thub.com/acme-corp/portal", "non_ascii"],
    ["fullwidth host", "https://ｇｉｔｈｕｂ.com/acme-corp/portal", "non_ascii"],
    ["query string", "https://github.com/acme-corp/portal?x=1", "query_or_fragment"],
    ["fragment", "https://github.com/acme-corp/portal#frag", "query_or_fragment"],
    // paths
    ["no path", "https://github.com", "missing_path"],
    ["single segment", "https://github.com/portal", "invalid_path"],
    ["root path", "https://github.com/", "invalid_path"],
    ["empty segment", "https://github.com/acme-corp//portal", "invalid_path"],
    ["dot-dot traversal", "https://github.com/acme-corp/../other/portal", "invalid_path"],
    ["dot segment", "https://github.com/acme-corp/./portal", "invalid_path"],
    ["odd path character", "https://github.com/acme-corp/por:tal", "invalid_path"],
    ["only .git", "https://github.com/.git", "invalid_path"],
    ["too many segments", `https://github.com/${Array(11).fill("a").join("/")}`, "invalid_path"],
    ["too long", `https://github.com/acme/${"a".repeat(2100)}`, "too_long"],
  ])("%s", (_name, input, reason) => {
    expect(normalizeDestination(input)).toEqual({ ok: false, reason });
  });

  it.each([undefined, null, 42, {}, [], true])("non-string input %p is rejected without throwing", (input) => {
    expect(normalizeDestination(input)).toEqual({ ok: false, reason: "invalid_type" });
  });

  it("never reflects credentials from the input in the result", () => {
    const result = normalizeDestination("https://user:hunter2@github.com/acme-corp/portal");
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });
});

describe("normalizeDestination: robustness", () => {
  it("never throws on hostile or random input", () => {
    const nasty = [
      "://",
      "a://",
      "https://@/",
      "https://:@:/",
      "@@@@",
      ":::::",
      "git@:",
      "git@host:",
      "ssh://git@host:22",
      "https://github.com/" + "%".repeat(100),
      "\u202ehttps://github.com/x/y",
      "https://github.com/a/b" + "/".repeat(5000),
      "\ud800",
      "a".repeat(100_000),
    ];
    for (const input of nasty) {
      expect(() => normalizeDestination(input)).not.toThrow();
      expect(normalizeDestination(input).ok).toBe(false);
    }
  });

  it("is idempotent through a canonical https round trip", () => {
    const first = normalizeDestination("git@GitHub.com:Acme-Corp/Portal.git");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = normalizeDestination(`https://${first.value.host}/${first.value.repoPath}`);
    expect(again).toEqual(first);
  });
});
