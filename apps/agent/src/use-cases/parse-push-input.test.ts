import { describe, expect, it } from "vitest";
import { parsePushInput } from "./parse-push-input.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const ZERO = "0".repeat(40);
const line = (localRef: string, localSha: string, remoteRef: string, remoteSha: string): string => `${localRef} ${localSha} ${remoteRef} ${remoteSha}`;

describe("parsePushInput", () => {
  it("classifies update, create and delete and starts with forcePush false", () => {
    const stdin = [line("refs/heads/a", A, "refs/heads/a", B), line("refs/heads/n", A, "refs/heads/n", ZERO), line("(delete)", ZERO, "refs/heads/old", B), ""].join("\n");
    const result = parsePushInput(stdin);
    expect(result).toEqual({
      ok: true,
      value: [
        { localRef: "refs/heads/a", localSha: A, remoteRef: "refs/heads/a", remoteSha: B, kind: "update", forcePush: false },
        { localRef: "refs/heads/n", localSha: A, remoteRef: "refs/heads/n", remoteSha: ZERO, kind: "create", forcePush: false },
        { localRef: "(delete)", localSha: ZERO, remoteRef: "refs/heads/old", remoteSha: B, kind: "delete", forcePush: false },
      ],
    });
  });

  it("accepts SHA-256 object ids and CRLF line endings", () => {
    const sha = "c".repeat(64);
    expect(parsePushInput(`${line("HEAD", sha, "refs/heads/m", "0".repeat(64))}\r\n`).ok).toBe(true);
  });

  it("empty input means no refs", () => {
    expect(parsePushInput("")).toEqual({ ok: true, value: [] });
    expect(parsePushInput("\n\n")).toEqual({ ok: true, value: [] });
  });

  it.each([
    ["too few fields", "refs/heads/a aaaa refs/heads/a"],
    ["too many fields", `${line("a", A, "b", B)} extra`],
    ["short sha", line("refs/heads/a", "abc123", "refs/heads/a", B)],
    ["uppercase sha", line("refs/heads/a", "A".repeat(40), "refs/heads/a", B)],
    ["non-hex sha", line("refs/heads/a", "g".repeat(40), "refs/heads/a", B)],
    ["mixed 40/64 length", line("refs/heads/a", A, "refs/heads/a", "b".repeat(64))],
    ["double space", `refs/heads/a  ${A} refs/heads/a ${B}`],
    ["leading space", ` ${line("refs/heads/a", A, "refs/heads/a", B)}`],
    ["tab separators", `refs/heads/a\t${A}\trefs/heads/a\t${B}`],
    ["one bad line among good ones", [line("a", A, "b", B), "nonsense"].join("\n")],
  ])("rejects %s", (_name, stdin) => {
    expect(parsePushInput(stdin)).toEqual({ ok: false, reason: "malformed_line" });
  });

  it("rejects an absurd number of refs", () => {
    const stdin = Array.from({ length: 1001 }, (_, i) => line(`refs/heads/b${i}`, A, `refs/heads/b${i}`, B)).join("\n");
    expect(parsePushInput(stdin)).toEqual({ ok: false, reason: "too_many_refs" });
  });
});
