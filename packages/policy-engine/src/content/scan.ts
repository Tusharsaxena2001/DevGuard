import type { Finding } from "@devguard/shared";
import { SECRET_RULES, type SecretRule } from "./secret-rules.js";

export const SCAN_ERROR_RULE_ID = "scan_error";

export interface AddedLine {
  readonly path: string;
  readonly commit: string;
  /** Input only. Never copied into a finding. */
  readonly text: string;
  readonly line?: number;
}

function located(line: AddedLine, ruleId: string, kind: Finding["kind"]): Finding {
  const base = { ruleId, kind, path: line.path, commit: line.commit };
  return line.line === undefined ? base : { ...base, line: line.line };
}

/**
 * Scan added lines of outgoing commits for the enabled secret rules.
 *
 * `enabledRuleIds` is the policy's `secretRules`; an empty list scans for nothing. Findings carry rule id, path,
 * commit and optional line, never the matched text. With no lines there is nothing to scan and so nothing to report. Fail-safe: an enabled id this engine does not know, or a rule that
 * throws, yields a `scan_error` finding (a block in enforce mode) rather than a silent skip. `catalog` is injectable
 * so a different detector can be adapted in later (ADR-005).
 */
export function scanAddedLines(
  lines: readonly AddedLine[],
  enabledRuleIds: readonly string[],
  catalog: readonly SecretRule[] = SECRET_RULES,
): Finding[] {
  const enabled = new Set(enabledRuleIds);
  const active = catalog.filter((r) => enabled.has(r.id));
  const hasUnknownRule = [...enabled].some((id) => !catalog.some((r) => r.id === id));

  const findings: Finding[] = [];
  const first = lines[0];
  if (hasUnknownRule && first) findings.push(located(first, SCAN_ERROR_RULE_ID, "scan_error"));

  const seen = new Set<string>();
  for (const line of lines) {
    for (const r of active) {
      let matched: boolean;
      let ruleId = r.id;
      let kind: Finding["kind"] = "secret";
      try {
        matched = r.matches(line.text);
      } catch {
        matched = true;
        ruleId = SCAN_ERROR_RULE_ID;
        kind = "scan_error";
      }
      if (!matched) continue;
      const key = `${ruleId}\0${line.commit}\0${line.path}\0${line.line ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(located(line, ruleId, kind));
    }
  }
  return findings;
}
