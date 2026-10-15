import { describe, expect, it } from "vitest";
import { AgentError } from "../errors.js";
import { isManaged, MARKER, PASSTHROUGH_HOOKS, renderPassthrough, renderPrePushWrapper, shellQuote } from "./hook-wrapper.js";

const agent = { nodePath: "/usr/bin/node", mainPath: "/opt/devguard/main.js", version: "1.2.3" };

describe("shellQuote", () => {
  it.each([
    ["plain", "'plain'"],
    ["with space", "'with space'"],
    ["it's", "'it'\\''s'"],
    ["$(rm -rf /)", "'$(rm -rf /)'"],
    ["`id`", "'`id`'"],
    ['a"b', `'a"b'`],
    ["a;b&c|d", "'a;b&c|d'"],
  ])("%j", (value, expected) => {
    expect(shellQuote(value)).toBe(expected);
  });

  it.each(["a\nb", "a\rb", "a\0b"])("rejects a value with a newline or NUL (%j)", (value) => {
    expect(() => shellQuote(value)).toThrow(AgentError);
  });

});

describe("renderPrePushWrapper", () => {
  const global = renderPrePushWrapper({ agent, devguardHome: "/home/dev/.config/devguard", mode: { kind: "global", previousHooksDir: null } });

  it("carries the marker and agent version", () => {
    expect(global).toContain(MARKER);
    expect(global).toContain("agent=1.2.3");
    expect(isManaged(global)).toBe(true);
  });

  it("pins DEVGUARD_HOME and absolute node/agent paths, and blocks when the agent is missing", () => {
    expect(global).toContain("DEVGUARD_HOME='/home/dev/.config/devguard'\nexport DEVGUARD_HOME");
    expect(global).toContain("DG_NODE='/usr/bin/node'");
    expect(global).toContain("DG_MAIN='/opt/devguard/main.js'");
    expect(global).toMatch(/if \[ ! -x "\$DG_NODE" \] \|\| \[ ! -f "\$DG_MAIN" \]; then[\s\S]*?exit 1/);
    expect(global).toContain("git config --global --unset core.hooksPath");
  });

  it("passes stdin to the agent and fails the push on any non-zero agent exit, before chaining", () => {
    expect(global).toContain('"$DG_NODE" "$DG_MAIN" hook pre-push -- "$@" < "$DG_IN" || exit $?');
    expect(global.indexOf("hook pre-push")).toBeLessThan(global.indexOf("dg_chain \"$(git"));
  });

  it("global mode without a previous hooksPath chains to the repository's own hook", () => {
    expect(global).toContain('dg_chain "$(git rev-parse --git-common-dir 2>/dev/null)/hooks/pre-push" "$@"');
  });

  it("global mode with a previous hooksPath chains to that directory only", () => {
    const script = renderPrePushWrapper({ agent, devguardHome: "/h", mode: { kind: "global", previousHooksDir: "/opt/team hooks/" } });
    expect(script).toContain(`dg_chain '/opt/team hooks/pre-push' "$@"`);
    expect(script).not.toContain("--git-common-dir");
  });

  it("repo mode chains to the original hook and tells the user how to remove it", () => {
    const script = renderPrePushWrapper({
      agent,
      devguardHome: "/h",
      mode: { kind: "repo", hookPath: "/r/.git/hooks/pre-push", originalHook: "/r/.git/hooks/pre-push.devguard-orig" },
    });
    expect(script).toContain(`dg_chain '/r/.git/hooks/pre-push.devguard-orig' "$@"`);
    expect(script).toContain("delete /r/.git/hooks/pre-push");
  });

  it("never chains to a script that carries the DevGuard marker (no loops or double scans)", () => {
    expect(global).toContain('! dg_is_managed "$dg_hook"');
    expect(global).toContain(`grep -q '^# ${MARKER}'`);
  });

  it("refuses paths that cannot be quoted safely", () => {
    expect(() => renderPrePushWrapper({ agent: { ...agent, mainPath: "/a\nb" }, devguardHome: "/h", mode: { kind: "global", previousHooksDir: null } })).toThrow(AgentError);
  });
});

describe("renderPassthrough", () => {
  it("hands over to the repository's own hook, or to the previous hooks directory", () => {
    expect(renderPassthrough("pre-commit", null)).toContain('"$(git rev-parse --git-common-dir 2>/dev/null)/hooks/pre-commit"');
    expect(renderPassthrough("pre-commit", "/opt/team")).toContain("'/opt/team/pre-commit'");
  });

  it("uses exec so stdin and the exit status reach the real hook unchanged, and skips DevGuard's own scripts", () => {
    const script = renderPassthrough("post-rewrite", null);
    expect(script).toContain('exec "$dg_hook" "$@"');
    expect(script).toContain('! dg_is_managed "$dg_hook"');
    expect(isManaged(script)).toBe(true);
  });

  it("never includes pre-push in the pass-through list", () => {
    expect(PASSTHROUGH_HOOKS).not.toContain("pre-push");
  });
});

describe("isManaged", () => {
  it("recognises only a script that carries the marker as its second line", () => {
    expect(isManaged(undefined)).toBe(false);
    expect(isManaged("#!/bin/sh\necho hi\n")).toBe(false);
    expect(isManaged(`#!/bin/sh\n# ${MARKER} v1\n`)).toBe(true);
  });

  it("a user's hook that merely mentions the marker is not ours (so it is never overwritten, deleted or skipped)", () => {
    expect(isManaged(`#!/bin/sh\n# my hook, see ${MARKER} docs\n`)).toBe(false);
    expect(isManaged(`#!/bin/sh\necho x\n# ${MARKER}\n`)).toBe(false);
    expect(isManaged(`# ${MARKER}\n`)).toBe(false);
  });

  it("every script DevGuard generates satisfies the rule", () => {
    expect(isManaged(renderPrePushWrapper({ agent, devguardHome: "/h", mode: { kind: "global", previousHooksDir: null } }))).toBe(true);
    for (const name of PASSTHROUGH_HOOKS) expect(isManaged(renderPassthrough(name, null))).toBe(true);
  });
});

describe("wrapper robustness", () => {
  const script = renderPrePushWrapper({ agent, devguardHome: "/h", mode: { kind: "global", previousHooksDir: null } });

  it("removes its stdin temp file on signals as well as on exit", () => {
    expect(script).toContain("trap 'rm -f \"$DG_IN\"' EXIT");
    for (const signal of ["HUP", "INT", "TERM"]) expect(script).toContain(`${signal}`);
    expect(script).toMatch(/trap 'exit 130' INT/);
  });

  it("covers the server-side hooks a global core.hooksPath would otherwise hide", () => {
    for (const name of ["pre-receive", "update", "post-receive", "post-update", "proc-receive"]) expect(PASSTHROUGH_HOOKS).toContain(name);
  });
});
