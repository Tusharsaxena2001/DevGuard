import { describe, expect, it } from "vitest";
import { parseAddedLines, parseNameStatusZ, unquoteCStyle } from "./diff-parse.js";

describe("parseNameStatusZ", () => {
  it("reads status/path pairs verbatim, including spaces, newlines and unicode", () => {
    const out = ["A", "src/a.ts", "M", "docs/my file.md", "D", "old.txt", "T", "link", "A", "we\nird\tname", "A", "café/é.ts", ""].join("\0");
    expect(parseNameStatusZ(out)).toEqual([
      { status: "A", path: "src/a.ts" },
      { status: "M", path: "docs/my file.md" },
      { status: "D", path: "old.txt" },
      { status: "T", path: "link" },
      { status: "A", path: "we\nird\tname" },
      { status: "A", path: "café/é.ts" },
    ]);
  });

  it("keeps an unknown status as a modification so a changed path is never dropped", () => {
    expect(parseNameStatusZ(["U", "conflict.txt", ""].join("\0"))).toEqual([{ status: "M", path: "conflict.txt" }]);
  });

  it("collapses the same entry reported once per parent of a merge commit", () => {
    expect(parseNameStatusZ(["A", "x", "A", "x", "M", "y", ""].join("\0"))).toEqual([
      { status: "A", path: "x" },
      { status: "M", path: "y" },
    ]);
  });

  it("ignores empty output and a dangling field", () => {
    expect(parseNameStatusZ("")).toEqual([]);
    expect(parseNameStatusZ("A\0")).toEqual([]);
  });
});

describe("unquoteCStyle", () => {
  it.each([
    ['"plain"', "plain"],
    ['"a\\tb"', "a\tb"],
    ['"a\\nb"', "a\nb"],
    ['"say \\"hi\\""', 'say "hi"'],
    ['"back\\\\slash"', "back\\slash"],
    ['"caf\\303\\251"', "café"],
    ['"\\344\\270\\255.txt"', "中.txt"],
    ['"emoji 😀"', "emoji 😀"],
  ])("%s -> %j", (quoted, expected) => {
    expect(unquoteCStyle(quoted)).toBe(expected);
  });
});

const patch = (...lines: string[]): string => `${lines.join("\n")}\n`;

describe("parseAddedLines", () => {
  it("extracts added lines with their new-file line numbers across hunks and files", () => {
    const out = patch(
      "diff --git a/src/a.ts b/src/a.ts",
      "index 111..222 100644",
      "--- src/a.ts",
      "+++ src/a.ts",
      "@@ -3,0 +4,2 @@",
      "+const a = 1;",
      "+const b = 2;",
      "@@ -10 +12 @@",
      "-old",
      "+new",
      "diff --git a/b.txt b/b.txt",
      "--- /dev/null",
      "+++ b.txt",
      "@@ -0,0 +1 @@",
      "+hello",
    );
    expect(parseAddedLines(out)).toEqual([
      { path: "src/a.ts", line: 4, text: "const a = 1;" },
      { path: "src/a.ts", line: 5, text: "const b = 2;" },
      { path: "src/a.ts", line: 12, text: "new" },
      { path: "b.txt", line: 1, text: "hello" },
    ]);
  });

  it("is not fooled by added lines that look like diff headers", () => {
    const out = patch("diff --git a/f b/f", "--- f", "+++ f", "@@ -0,0 +1,3 @@", "+++ b/evil", "+@@ -1 +1 @@", "+diff --git a/x b/x");
    expect(parseAddedLines(out)).toEqual([
      { path: "f", line: 1, text: "++ b/evil" },
      { path: "f", line: 2, text: "@@ -1 +1 @@" },
      { path: "f", line: 3, text: "diff --git a/x b/x" },
    ]);
  });

  it("handles the no-newline marker, deleted files, binary files and mode-only changes", () => {
    const out = patch(
      "diff --git a/n b/n",
      "+++ n",
      "@@ -1 +1 @@",
      "-a",
      "\\ No newline at end of file",
      "+b",
      "\\ No newline at end of file",
      "diff --git a/gone b/gone",
      "deleted file mode 100644",
      "--- gone",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      "diff --git a/img.png b/img.png",
      "Binary files a/img.png and b/img.png differ",
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
    );
    expect(parseAddedLines(out)).toEqual([{ path: "n", line: 1, text: "b" }]);
  });

  it("decodes quoted paths and strips the trailing TAB Git adds after names with spaces", () => {
    const out = patch("diff --git a/x b/x", '+++ "we\\tird\\303\\251.txt"', "@@ -0,0 +1 @@", "+one", "diff --git a/y b/y", "+++ my file.txt\t", "@@ -0,0 +1 @@", "+two");
    expect(parseAddedLines(out)).toEqual([
      { path: "we\tirdé.txt", line: 1, text: "one" },
      { path: "my file.txt", line: 1, text: "two" },
    ]);
  });

  it("strips the TAB Git adds after a quoted name that contains a space and a quote", () => {
    const out = patch("diff --git a/x b/x", '+++ "say \\"hi\\".txt"\t', "@@ -0,0 +1 @@", "+x");
    expect(parseAddedLines(out)).toEqual([{ path: 'say "hi".txt', line: 1, text: "x" }]);
  });

  it("repeats lines once per parent for a merge commit (the scanner dedupes)", () => {
    const out = patch("0123456789012345678901234567890123456789 (from aaaa)", "diff --git a/f b/f", "+++ f", "@@ -0,0 +1 @@", "+x", "0123456789012345678901234567890123456789 (from bbbb)", "diff --git a/f b/f", "+++ f", "@@ -0,0 +1 @@", "+x");
    expect(parseAddedLines(out)).toHaveLength(2);
  });

  it("a malformed hunk never throws and never mislabels a later file", () => {
    const out = patch("diff --git a/f b/f", "+++ f", "@@ -0,0 +1,5 @@", "+only one", "garbage line", "diff --git a/g b/g", "+++ g", "@@ -0,0 +1 @@", "+ok");
    expect(parseAddedLines(out)).toEqual([
      { path: "f", line: 1, text: "only one" },
      { path: "g", line: 1, text: "ok" },
    ]);
  });

  it("returns nothing for empty input and keeps CR characters in the text", () => {
    expect(parseAddedLines("")).toEqual([]);
    expect(parseAddedLines(patch("diff --git a/f b/f", "+++ f", "@@ -0,0 +1 @@", "+win\r"))).toEqual([{ path: "f", line: 1, text: "win\r" }]);
  });
});
