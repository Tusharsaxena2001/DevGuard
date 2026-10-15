import type { AddedLineRecord } from "../../ports/git.js";
import type { ChangedFileStatus } from "../../ports/git-types.js";

const STATUSES: ReadonlySet<string> = new Set(["A", "M", "D", "T"]);

/**
 * Parse `git diff-tree --name-status -z --no-renames` output: `<status>\0<path>\0` repeated. Paths are verbatim
 * (no quoting with -z). Entries with an unknown status (e.g. unmerged `U`, or copies we did not ask for) are kept as
 * modifications so a changed path is never silently dropped.
 */
export function parseNameStatusZ(output: string): ChangedFileStatus[] {
  const parts = output.split("\0");
  const seen = new Set<string>();
  const result: ChangedFileStatus[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const raw = parts[i] ?? "";
    const path = parts[i + 1] ?? "";
    if (raw === "" || path === "") continue;
    const letter = raw.charAt(0);
    const status = STATUSES.has(letter) ? (letter as ChangedFileStatus["status"]) : "M";
    const key = `${status}\0${path}`;
    if (seen.has(key)) continue; // merge commits (-m) report the same path once per parent
    seen.add(key);
    result.push({ path, status });
  }
  return result;
}

const C_ESCAPES: Readonly<Record<string, number>> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/** Undo Git's C-style path quoting (`"a\tb\303\251"`), which patch headers use for unusual names. */
export function unquoteCStyle(quoted: string): string {
  const inner = quoted.slice(1, -1);
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < inner.length; i++) {
    const ch = inner.charAt(i);
    if (ch !== "\\") {
      bytes.push(...encoder.encode(inner.slice(i, i + (inner.codePointAt(i)! > 0xffff ? 2 : 1))));
      if (inner.codePointAt(i)! > 0xffff) i++;
      continue;
    }
    const next = inner.charAt(i + 1);
    const octal = /^[0-7]{3}/.exec(inner.slice(i + 1, i + 4));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else if (next in C_ESCAPES) {
      bytes.push(C_ESCAPES[next] ?? 0);
      i += 1;
    } else {
      bytes.push(...encoder.encode("\\"));
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes));
}

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Extract added lines from a unified diff produced with `-U0 --no-prefix`. Hunk bodies are consumed using the line
 * counts in the hunk header, so an added line whose text happens to start with `++ ` or `@@` is never mistaken for a
 * header. Binary files have no hunks and yield nothing (documented limitation).
 */
export function parseAddedLines(patch: string): AddedLineRecord[] {
  const added: AddedLineRecord[] = [];
  let path: string | undefined;
  let remainingOld = 0;
  let remainingNew = 0;
  let nextLine = 0;

  for (const line of patch.split("\n")) {
    if (remainingOld > 0 || remainingNew > 0) {
      const marker = line.charAt(0);
      if (marker === "+" && remainingNew > 0) {
        if (path !== undefined) added.push({ path, line: nextLine, text: line.slice(1) });
        nextLine++;
        remainingNew--;
        continue;
      }
      if (marker === "-" && remainingOld > 0) {
        remainingOld--;
        continue;
      }
      if (marker === "\\") continue; // "\ No newline at end of file"
      remainingOld = 0;
      remainingNew = 0; // malformed hunk: fall through and treat the line as a header
    }

    if (line.startsWith("diff ")) {
      path = undefined;
    } else if (line.startsWith("+++ ")) {
      // Git appends a TAB after names containing spaces, quoted or not. A real trailing TAB would have been quoted.
      const name = line.slice(4).replace(/\t$/, "");
      if (name === "/dev/null") path = undefined;
      else path = name.startsWith('"') ? unquoteCStyle(name) : name;
    } else {
      const hunk = HUNK.exec(line);
      if (hunk) {
        remainingOld = hunk[1] === undefined ? 1 : Number(hunk[1]);
        nextLine = Number(hunk[2]);
        remainingNew = hunk[3] === undefined ? 1 : Number(hunk[3]);
      }
    }
  }
  return added;
}
